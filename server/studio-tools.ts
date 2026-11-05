import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  createReadStream,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, ROOT } from './config.js';
import type { Job } from './studio.js';

export type WorkflowField = {
  node: string;
  field: string;
  label: string;
  group: string;
  value: string | number | boolean;
  kind: 'text' | 'number' | 'toggle';
  options?: string[];
};
export function inspectGraph(graph: Record<string, any>) {
  const fields: WorkflowField[] = [];
  let binding: { node: string; field: string; template?: string } | undefined;
  // Follow the sampler's actual positive conditioning before using a title heuristic.
  for (const node of Object.values(graph)) {
    const link = node.inputs?.positive;
    if (
      Array.isArray(link) &&
      graph[link[0]]?.class_type === 'CLIPTextEncode' &&
      typeof graph[link[0]].inputs.text === 'string'
    )
      binding = { node: link[0], field: 'text' };
  }
  for (const [id, n] of Object.entries(graph)) {
    const title = String(n._meta?.title ?? n.class_type);
    if (!binding && !/negative|system|upsampler/i.test(title)) {
      const key = ['text', 'value', 'prompt'].find(
        (k) =>
          typeof n.inputs?.[k] === 'string' && n.inputs[k].length > 0 && n.inputs[k].length < 2000,
      );
      if (key && /positive|prompt|CLIPTextEncode/i.test(title)) binding = { node: id, field: key };
    }
    for (const [field, value] of Object.entries(n.inputs ?? {})) {
      if (
        !['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'string' && value.length > 1500)
      )
        continue;
      if (/filename_prefix|system_prompt/.test(field)) continue;
      fields.push({
        node: id,
        field,
        label: field.replace(/_/g, ' '),
        group: `${title} · ${id}`,
        value: value as any,
        kind: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'toggle' : 'text',
      });
    }
  }
  return { fields, binding };
}
export function touchWorker(db: Database.Database, name: string) {
  db.prepare('INSERT OR REPLACE INTO studio_workers (name,seen) VALUES (?,?)').run(
    name,
    Date.now(),
  );
}
type Dependencies = {
  db: Database.Database;
  getJob: (id: string) => Job | undefined;
  saveJob: (job: Job) => unknown;
};
export function validateAssetBindings(db: Database.Database, graph: any, assets: any) {
  if (assets === undefined) return;
  if (!Array.isArray(assets) || assets.length > 12)
    throw new Error('A workflow supports at most 12 uploaded assets');
  for (const a of assets) {
    const row: any =
      typeof a.id === 'string'
        ? db.prepare('SELECT body FROM studio_assets WHERE id=?').get(a.id)
        : undefined;
    if (!row || !graph[a.node]?.inputs || !(a.field in graph[a.node].inputs))
      throw new Error('An uploaded media binding is missing or invalid');
    a.name = JSON.parse(row.body).name;
  }
}
export async function materializeLocalAssets(
  db: Database.Database,
  graph: any,
  assets: any[] = [],
) {
  const copy = structuredClone(graph);
  for (const asset of assets) {
    const row: any = db.prepare('SELECT body FROM studio_assets WHERE id=?').get(asset.id);
    if (!row) throw new Error('Uploaded media was not found');
    const stored = JSON.parse(row.body);
    const data = readFileSync(join(config.dataDir, 'studio-artifacts', stored.id, stored.name));
    const form = new FormData();
    form.append('image', new Blob([data]), stored.name);
    form.append('type', 'input');
    form.append('overwrite', 'false');
    const response = await fetch(config.comfyUrl + '/upload/image', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('ComfyUI did not accept the media upload');
    const result: any = await response.json();
    if (!result.name) throw new Error('ComfyUI returned no uploaded filename');
    copy[asset.node].inputs[asset.field] = [result.subfolder, result.name]
      .filter(Boolean)
      .join('/');
  }
  return copy;
}
export function registerStudioTools(
  app: FastifyInstance,
  { db, getJob, saveJob }: Dependencies,
  workerAuth: (req: any, reply: any) => boolean,
) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS studio_workers (name TEXT PRIMARY KEY, seen INTEGER NOT NULL)',
  );
  db.exec('CREATE TABLE IF NOT EXISTS studio_assets (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  app.post('/api/studio/assets', async (req, reply) => {
    const b = req.body as any;
    if (
      typeof b?.name !== 'string' ||
      typeof b?.base64 !== 'string' ||
      b.base64.length > 60000000 ||
      !b.base64.length
    )
      return reply.code(400).send({ error: 'Choose a media file up to 45 MB' });
    const name = b.name.replace(/[^\w.-]/g, '_');
    if (!/\.(png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|flac)$/i.test(name))
      return reply.code(400).send({ error: 'Choose an image, video, or supported audio file' });
    const id = 'asset-' + randomUUID(),
      folder = join(config.dataDir, 'studio-artifacts', id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), Buffer.from(b.base64, 'base64'));
    const asset = { id, name, url: `/api/studio/artifacts/${id}/${name}` };
    db.prepare('INSERT INTO studio_assets VALUES (?,?)').run(id, JSON.stringify(asset));
    return asset;
  });
  app.get('/api/studio/worker/assets/:id', async (req, reply) => {
    if (!workerAuth(req, reply)) return;
    const row: any = db
      .prepare('SELECT body FROM studio_assets WHERE id=?')
      .get((req.params as any).id);
    if (!row) return reply.code(404).send({ error: 'Asset not found' });
    const asset = JSON.parse(row.body);
    return reply
      .type('application/octet-stream')
      .send(createReadStream(join(config.dataDir, 'studio-artifacts', asset.id, asset.name)));
  });
  let cachedHealth: any,
    healthUntil = 0;
  app.get('/api/studio/health', async () => {
    if (Date.now() < healthUntil) return cachedHealth;
    let local: any = { online: false, url: config.comfyUrl };
    try {
      const r = await fetch(`${config.comfyUrl}/system_stats`, {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        const stats: any = await r.json();
        local = {
          online: true,
          url: config.comfyUrl,
          devices: (stats.devices ?? []).map((d: any) => ({
            name: d.name,
            vramFree: d.vram_free,
            vramTotal: d.vram_total,
          })),
        };
      }
    } catch {}
    const workers = db
      .prepare('SELECT name,seen FROM studio_workers ORDER BY name')
      .all()
      .map((w: any) => ({ ...w, online: Date.now() - w.seen < 45000 }));
    cachedHealth = { local, workers, checked: Date.now() };
    healthUntil = Date.now() + 3000;
    return cachedHealth;
  });
  app.get('/api/studio/workflows/:id/settings', async (req, reply) => {
    const id = (req.params as any).id;
    if (!/^[\w-]+$/.test(id)) return reply.code(400).send({ error: 'Invalid workflow' });
    const file = join(ROOT, 'integrations', 'workflows', id + '.json');
    if (!existsSync(file)) return reply.code(404).send({ error: 'Workflow not found' });
    const result = inspectGraph(JSON.parse(readFileSync(file, 'utf8')));
    const match = id.match(/^freefield--apps_([\w-]+)_workflow_api$/);
    if (match) {
      const manifest = join(
        ROOT,
        'integrations',
        'sources',
        'freefield',
        'apps',
        match[1],
        'app.json',
      );
      if (existsSync(manifest)) {
        const spec = JSON.parse(readFileSync(manifest, 'utf8'));
        const b = spec.inputs?.find((i: any) => i.id === 'prompt')?.bind?.[0];
        if (b) result.binding = { node: b.node, field: b.field, template: b.template };
      }
    }
    return result;
  });
  app.post('/api/studio/preflight', async (req, reply) => {
    const b = req.body as any;
    if (
      !b?.workflow ||
      typeof b.workflow !== 'object' ||
      Array.isArray(b.workflow) ||
      !Object.keys(b.workflow).length ||
      Object.values(b.workflow).some(
        (n: any) =>
          !n || typeof n.class_type !== 'string' || !n.inputs || typeof n.inputs !== 'object',
      )
    )
      return reply.code(400).send({ error: 'Choose an API workflow first' });
    const graph = b.workflow,
      result = inspectGraph(graph),
      missingNodes: string[] = [],
      invalidValues: { node: string; field: string; value: unknown }[] = [],
      brokenLinks: string[] = [];
    for (const [id, node] of Object.entries(graph) as [string, any][]) {
      for (const [field, v] of Object.entries(node.inputs ?? {})) {
        if (
          Array.isArray(v) &&
          v.length === 2 &&
          typeof v[0] === 'string' &&
          typeof v[1] === 'number' &&
          !graph[v[0]]
        )
          brokenLinks.push(`${id}.${field} → missing node ${v[0]}`);
      }
    }
    let online = false;
    if (b.mode === 'local')
      try {
        const response = await fetch(`${config.comfyUrl}/object_info`, {
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          online = true;
          const info: any = await response.json();
          for (const [id, node] of Object.entries(graph) as [string, any][]) {
            const spec = info[node.class_type];
            if (!spec) {
              missingNodes.push(node.class_type);
              continue;
            }
            const inputs = { ...spec.input?.required, ...spec.input?.optional };
            for (const [field, value] of Object.entries(node.inputs ?? {})) {
              const options = inputs[field]?.[0];
              if (Array.isArray(options) && options.every((o) => typeof o === 'string')) {
                const f = result.fields.find((f) => f.node === id && f.field === field);
                if (f) f.options = options;
                if (
                  !Array.isArray(value) &&
                  (typeof value !== 'string' || !options.includes(value)) &&
                  !b.assets?.some((a: any) => a.node === id && a.field === field)
                )
                  invalidValues.push({ node: id, field, value });
              }
            }
          }
        }
      } catch {}
    return {
      ...result,
      online,
      missingNodes: [...new Set(missingNodes)],
      invalidValues,
      brokenLinks,
      ready: online && !missingNodes.length && !invalidValues.length && !brokenLinks.length,
      scope: b.mode === 'local' ? 'local' : 'structure',
      note:
        b.mode === 'kaggle'
          ? 'Kaggle checks graph structure here. Model and node availability are checked on the notebook worker.'
          : online
            ? 'Checked against your running ComfyUI.'
            : 'ComfyUI is offline. Start it to check models and node availability.',
    };
  });
  const archiving = new Set<string>();
  async function archive(id: string) {
    const job = getJob(id);
    if (!job || job.status !== 'completed') throw new Error('Only completed takes can be archived');
    if (archiving.has(id)) return { pending: true };
    archiving.add(id);
    const replacements: string[] = [];
    try {
      for (const [index, url] of job.outputs.entries()) {
        if (url.startsWith('/api/studio/artifacts/')) {
          replacements.push(url);
          continue;
        }
        if (!/^https?:\/\//i.test(url)) throw new Error('Unsupported output URL');
        const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok || !response.body)
          throw new Error(`Media download returned HTTP ${response.status}`);
        const types: Record<string, string> = {
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/webp': 'webp',
          'image/gif': 'gif',
          'video/mp4': 'mp4',
          'video/webm': 'webm',
          'audio/mpeg': 'mp3',
          'audio/wav': 'wav',
          'audio/flac': 'flac',
        };
        const parsed = new URL(url),
          filename = parsed.searchParams.get('filename') ?? parsed.pathname;
        const suffix =
          types[(response.headers.get('content-type') ?? '').split(';')[0]] ??
          filename.match(/\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav|flac)$/i)?.[1];
        if (!suffix) throw new Error('The output is not a supported media format');
        const dir = join(config.dataDir, 'studio-artifacts', job.id);
        mkdirSync(dir, { recursive: true });
        const name = `saved-${index}.${suffix.toLowerCase()}`,
          target = join(dir, name),
          partial = target + '.partial';
        let bytes = 0;
        const limiter = new Transform({
          transform(chunk, _enc, callback) {
            bytes += chunk.length;
            callback(
              bytes > 256000000 ? new Error('Media exceeds the 256 MB archive limit') : null,
              chunk,
            );
          },
        });
        try {
          await pipeline(
            Readable.fromWeb(response.body as any),
            limiter,
            createWriteStream(partial),
          );
          renameSync(partial, target);
        } catch (e) {
          rmSync(partial, { force: true });
          throw e;
        }
        replacements.push(`/api/studio/artifacts/${job.id}/${name}`);
      }
      const latest = getJob(id)!;
      latest.outputs = replacements;
      latest.archived = true;
      latest.archiveError = undefined;
      saveJob(latest);
      return { outputs: replacements };
    } catch (e) {
      const latest = getJob(id);
      if (latest) {
        latest.archiveError = (e as Error).message;
        saveJob(latest);
      }
      throw e;
    } finally {
      archiving.delete(id);
    }
  }
  app.post('/api/studio/jobs/:id/archive', async (req, reply) => {
    try {
      return await archive((req.params as any).id);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.decorate('archiveStudioTake', archive);
}
