/** Open Higgs orchestration. Credentials remain in the server environment. */
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { config, ROOT } from './config.js';
import {
  registerStudioTools,
  touchWorker,
  validateAssetBindings,
  materializeLocalAssets,
} from './studio-tools.js';

export type Mode = 'wavespeed' | 'kie' | 'local' | 'kaggle';
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type Job = {
  id: string;
  projectId: string;
  shotId: string;
  mode: Mode;
  status: string;
  model: string;
  prompt: string;
  payload: Record<string, unknown>;
  remoteId?: string;
  outputs: string[];
  error?: string;
  worker?: string;
  lease?: string;
  leaseUntil?: number;
  created: number;
  archived?: boolean;
  archiveError?: string;
};
export function validateGraph(graph: unknown): asserts graph is Graph {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph) || !Object.keys(graph).length)
    throw new Error('Import a nonempty ComfyUI API-format workflow.');
  for (const [id, node] of Object.entries(graph)) {
    if (
      !node ||
      typeof node.class_type !== 'string' ||
      !node.inputs ||
      typeof node.inputs !== 'object' ||
      Array.isArray(node.inputs)
    )
      throw new Error(`Node ${id} is not an API-format node.`);
  }
}
export function prepareGraph(
  graph: unknown,
  prompt: string,
  binding?: { node: string; field: string },
): Graph {
  validateGraph(graph);
  const copy = structuredClone(graph);
  if (binding) {
    if (!copy[binding.node] || !(binding.field in copy[binding.node].inputs))
      throw new Error('The prompt binding does not exist in this workflow.');
    copy[binding.node].inputs[binding.field] = prompt;
  }
  return copy;
}
export function normalizeResult(
  mode: Mode,
  body: any,
): { status: string; outputs: string[]; error?: string } {
  const d = body.data ?? body;
  if (mode === 'wavespeed')
    return {
      status:
        d.status === 'completed'
          ? 'completed'
          : ['failed', 'cancelled', 'timeout', 'deleted'].includes(d.status)
            ? 'failed'
            : 'running',
      outputs: d.outputs ?? [],
      error: d.error,
    };
  if (mode === 'kie') {
    let result: any = {};
    if (d.resultJson)
      result = typeof d.resultJson === 'string' ? JSON.parse(d.resultJson) : d.resultJson;
    return {
      status: d.state === 'success' ? 'completed' : d.state === 'fail' ? 'failed' : 'running',
      outputs: result.resultUrls ?? [],
      error: d.failMsg,
    };
  }
  return { status: 'running', outputs: [] };
}
async function json(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const body: any = await response.json();
  if (!response.ok || (body.code !== undefined && body.code !== 200))
    throw new Error(
      `Upstream request rejected (${response.status}): ${body.message ?? body.msg ?? JSON.stringify(body).slice(0, 500)}`,
    );
  return body;
}
const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
});
export function registerStudio(app: FastifyInstance) {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(join(config.dataDir, 'studio.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS studio_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);',
  );
  const allJobs = () =>
    db
      .prepare('SELECT body FROM studio_jobs ORDER BY rowid DESC')
      .all()
      .map((r: any) => JSON.parse(r.body) as Job);
  const getJob = (id: string): Job | undefined => {
    const r: any = db.prepare('SELECT body FROM studio_jobs WHERE id=?').get(id);
    return r ? JSON.parse(r.body) : undefined;
  };
  const saveJob = (j: Job) =>
    db.prepare('INSERT OR REPLACE INTO studio_jobs VALUES (?,?)').run(j.id, JSON.stringify(j));
  db.exec('CREATE TABLE IF NOT EXISTS studio_requests (key TEXT PRIMARY KEY, body TEXT NOT NULL)');
  // A process interruption during submission must never create a second paid task.
  for (const j of allJobs())
    if (j.status === 'submitting')
      saveJob({
        ...j,
        status: 'unknown',
        error: 'Submission interrupted. Check provider history before submitting another take.',
      });
  const providerKey = (mode: Mode) =>
    mode === 'wavespeed' ? process.env.WAVESPEED_API_KEY : process.env.KIE_API_KEY;
  const workerAuth = (request: any, reply: any) => {
    const expected = process.env.OPENHIGGS_WORKER_TOKEN ?? '';
    const supplied = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    const a = Buffer.from(expected),
      b = Buffer.from(supplied);
    if (a.length < 24 || a.length !== b.length || !timingSafeEqual(a, b)) {
      reply
        .code(401)
        .send({ error: 'A valid worker token of at least 24 characters is required.' });
      return false;
    }
    return true;
  };
  registerStudioTools(app, { db, getJob, saveJob }, workerAuth);
  app.addHook('onRequest', async (req, reply) => {
    if (
      !req.url.startsWith('/api/studio') ||
      ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
      req.url.startsWith('/api/studio/worker')
    )
      return;
    const origin = req.headers.origin;
    if (origin) {
      try {
        const u = new URL(origin),
          host = new URL('http://' + req.headers.host);
        const sameOrigin = u.host === host.host;
        const devProxy = u.hostname === host.hostname && u.port === String(config.uiPort);
        if (!['http:', 'https:'].includes(u.protocol) || (!sameOrigin && !devProxy))
          return reply.code(403).send({ error: 'Cross-origin writes are disabled.' });
      } catch {
        return reply.code(403).send({ error: 'Invalid origin' });
      }
    }
  });
  app.get('/api/studio/providers', async () => [
    {
      id: 'wavespeed',
      label: 'WaveSpeed',
      ready: !!process.env.WAVESPEED_API_KEY,
      detail: 'Set WAVESPEED_API_KEY on the server',
    },
    {
      id: 'kie',
      label: 'Kie.ai',
      ready: !!process.env.KIE_API_KEY,
      detail: 'Set KIE_API_KEY on the server',
    },
    {
      id: 'local',
      label: 'Local GPU',
      ready: true,
      detail: `ComfyUI: ${config.comfyUrl}. Availability is checked on submission.`,
    },
    {
      id: 'kaggle',
      label: 'Kaggle · twin T4',
      ready: (process.env.OPENHIGGS_WORKER_TOKEN?.length ?? 0) >= 24,
      detail: 'Start the included notebook to connect two GPU workers',
    },
  ]);
  app.get('/api/studio/sources', async () => {
    const file = join(ROOT, 'integrations', 'manifest.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  });
  app.get('/api/studio/workflows/:id', async (req, reply) => {
    const id = (req.params as any).id;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return reply.code(400).send({ error: 'Invalid workflow id' });
    const file = join(ROOT, 'integrations', 'workflows', `${id}.json`);
    return existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : reply.code(404).send({ error: 'Workflow not found' });
  });
  app.get('/api/studio/projects', async () =>
    db
      .prepare('SELECT body FROM projects')
      .all()
      .map((r: any) => JSON.parse(r.body)),
  );
  app.put('/api/studio/projects/:id', async (req, reply) => {
    const project = req.body as any,
      id = (req.params as any).id;
    if (
      !project ||
      project.id !== id ||
      !Array.isArray(project.shots) ||
      typeof project.name !== 'string'
    )
      return reply.code(400).send({ error: 'Invalid project' });
    db.prepare('INSERT OR REPLACE INTO projects VALUES (?,?)').run(id, JSON.stringify(project));
    return { ok: true };
  });
  app.get('/api/studio/jobs', async () => allJobs());
  function makeJob(b: any): Job {
    if (!b || typeof b !== 'object') throw new Error('Provide a shot request.');
    if (
      !['wavespeed', 'kie', 'local', 'kaggle'].includes(b.mode) ||
      typeof b.prompt !== 'string' ||
      !b.prompt.trim() ||
      typeof b.projectId !== 'string' ||
      typeof b.shotId !== 'string'
    )
      throw new Error('Choose a backend and enter a shot prompt.');
    if (!db.prepare('SELECT id FROM projects WHERE id=?').get(b.projectId))
      throw new Error('Save the project before generating.');
    const payload = structuredClone(b.payload ?? {});
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('Model parameters must be a JSON object.');
    if (b.mode === 'local' || b.mode === 'kaggle') {
      payload.workflow = prepareGraph(payload.workflow, b.prompt, payload.binding);
      validateAssetBindings(db, payload.workflow, payload.assets);
    } else {
      if (!providerKey(b.mode))
        throw new Error(
          `Set ${b.mode === 'wavespeed' ? 'WAVESPEED_API_KEY' : 'KIE_API_KEY'} on the server first.`,
        );
      if (
        typeof b.model !== 'string' ||
        !/^[a-zA-Z0-9_./-]+$/.test(b.model) ||
        b.model.includes('..')
      )
        throw new Error('Enter a valid provider model ID.');
      if (!payload.input || typeof payload.input !== 'object' || Array.isArray(payload.input))
        throw new Error('Provide the provider-specific input object.');
    }
    if (b.mode === 'kaggle' && (process.env.OPENHIGGS_WORKER_TOKEN?.length ?? 0) < 24)
      throw new Error('Configure OPENHIGGS_WORKER_TOKEN first.');
    const j: Job = {
      id: randomUUID(),
      projectId: b.projectId,
      shotId: b.shotId,
      prompt: b.prompt,
      mode: b.mode,
      model: b.model ?? '',
      payload,
      status: 'queued',
      outputs: [],
      created: Date.now(),
    };
    return j;
  }
  function pumpQueue() {
    const jobs = allJobs();
    const limits: Record<string, number> = { local: 1, wavespeed: 2, kie: 2 };
    const active: Record<string, number> = {};
    for (const job of jobs)
      if (['running', 'submitting'].includes(job.status))
        active[job.mode] = (active[job.mode] ?? 0) + 1;
    for (const job of jobs.reverse())
      if (
        job.status === 'queued' &&
        job.mode !== 'kaggle' &&
        (active[job.mode] ?? 0) < limits[job.mode]
      ) {
        active[job.mode] = (active[job.mode] ?? 0) + 1;
        void submit(job);
      }
  }
  function enqueue(items: any[], requestKey?: unknown) {
    if (!items.length || items.length > 24)
      throw new Error('Queue between 1 and 24 shots at a time.');
    const hash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
    if (requestKey !== undefined) {
      if (typeof requestKey !== 'string' || !/^[\w-]{8,120}$/.test(requestKey))
        throw new Error('Invalid idempotency key.');
      const row: any = db.prepare('SELECT body FROM studio_requests WHERE key=?').get(requestKey);
      if (row) {
        const prior = JSON.parse(row.body);
        if (prior.hash !== hash)
          throw Object.assign(new Error('That idempotency key belongs to a different request.'), {
            statusCode: 409,
          });
        return { jobs: prior.jobs.map((id: string) => getJob(id)), replayed: true };
      }
    }
    const jobs = items.map(makeJob);
    db.transaction(() => {
      for (const job of jobs) saveJob(job);
      if (typeof requestKey === 'string')
        db.prepare('INSERT INTO studio_requests VALUES (?,?)').run(
          requestKey,
          JSON.stringify({ hash, jobs: jobs.map((j) => j.id) }),
        );
    })();
    pumpQueue();
    return { jobs: jobs.map((j) => getJob(j.id)!), replayed: false };
  }
  app.post('/api/studio/jobs', async (req, reply) => {
    try {
      const result = enqueue([req.body], (req.body as any)?.idempotencyKey);
      return reply.code(result.replayed ? 200 : 202).send(result.jobs[0]);
    } catch (e) {
      return reply.code((e as any).statusCode ?? 400).send({ error: (e as Error).message });
    }
  });
  app.post('/api/studio/jobs/batch', async (req, reply) => {
    try {
      const b = req.body as any;
      if (!Array.isArray(b?.jobs)) throw new Error('Provide the shots to queue.');
      const ids = b.jobs.map((j: any) => `${j.projectId}:${j.shotId}`);
      if (new Set(ids).size !== ids.length)
        throw new Error('Each shot can appear only once in a batch.');
      const result = enqueue(b.jobs, b.idempotencyKey);
      return reply.code(result.replayed ? 200 : 202).send(result);
    } catch (e) {
      return reply.code((e as any).statusCode ?? 400).send({ error: (e as Error).message });
    }
  });
  app.post('/api/studio/jobs/:id/cancel', async (req, reply) => {
    const job = getJob((req.params as any).id);
    if (!job) return reply.code(404).send({ error: 'Take not found.' });
    if (job.status !== 'queued')
      return reply
        .code(409)
        .send({ error: 'Only a take that has not started can be canceled here.' });
    job.status = 'cancelled';
    job.error = undefined;
    saveJob(job);
    return job;
  });
  app.post('/api/studio/jobs/:id/recover', async (req, reply) => {
    const job = getJob((req.params as any).id),
      id = (req.body as any)?.remoteId;
    if (!job) return reply.code(404).send({ error: 'Take not found.' });
    if (job.status !== 'unknown' || job.mode === 'kaggle')
      return reply
        .code(409)
        .send({ error: 'Recovery is available only for an unknown provider or local submission.' });
    if (typeof id !== 'string' || !/^[\w-]{4,200}$/.test(id))
      return reply
        .code(400)
        .send({ error: 'Paste the task ID from your provider or ComfyUI history.' });
    job.remoteId = id;
    job.status = 'running';
    job.error = undefined;
    saveJob(job);
    return job;
  });
  async function submit(j: Job) {
    j.status = 'submitting';
    saveJob(j);
    try {
      let body: any;
      if (j.mode === 'local') {
        const graph = await materializeLocalAssets(
          db,
          j.payload.workflow,
          (j.payload.assets ?? []) as any[],
        );
        body = await json(`${config.comfyUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: graph, client_id: j.id }),
        });
        if (body.error || Object.keys(body.node_errors ?? {}).length)
          throw new Error(`ComfyUI workflow rejected: ${JSON.stringify(body).slice(0, 700)}`);
        j.remoteId = body.prompt_id;
      } else {
        const input = { ...(j.payload.input as object), prompt: j.prompt };
        body = await json(
          j.mode === 'wavespeed'
            ? `https://api.wavespeed.ai/api/v3/${j.model}`
            : 'https://api.kie.ai/api/v1/jobs/createTask',
          {
            method: 'POST',
            headers: headers(providerKey(j.mode)!),
            body: JSON.stringify(j.mode === 'wavespeed' ? input : { model: j.model, input }),
          },
        );
        j.remoteId = j.mode === 'wavespeed' ? body.data?.id : body.data?.taskId;
      }
      if (!j.remoteId)
        throw new Error('No task ID returned. Check upstream history before resubmitting.');
      j.status = 'running';
    } catch (e) {
      j.status = 'unknown';
      j.error = `${(e as Error).message} Submission was not retried; verify upstream history.`;
    }
    saveJob(j);
  }
  let ticking = false;
  const timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      for (const j of allJobs().filter((j) => j.status === 'running' && j.mode !== 'kaggle')) {
        try {
          if (j.mode === 'local') {
            const body = await json(`${config.comfyUrl}/history/${j.remoteId}`),
              record = body[j.remoteId!];
            if (!record) continue;
            if (record.status?.status_str === 'error') {
              j.status = 'failed';
              j.error = JSON.stringify(record.status.messages);
            } else if (record.status?.completed) {
              j.status = 'completed';
              j.outputs = [];
              for (const output of Object.values(record.outputs ?? {}) as any[])
                for (const key of ['images', 'gifs', 'videos', 'audio', 'files'])
                  for (const f of output[key] ?? []) {
                    if (f.filename)
                      j.outputs.push(
                        `${config.comfyUrl}/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' })}`,
                      );
                  }
            }
          } else {
            const url =
              j.mode === 'wavespeed'
                ? `https://api.wavespeed.ai/api/v3/predictions/${j.remoteId}/result`
                : `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(j.remoteId!)}`;
            Object.assign(
              j,
              normalizeResult(j.mode, await json(url, { headers: headers(providerKey(j.mode)!) })),
            );
          }
          if (j.status === 'completed' && !j.outputs.length) {
            j.status = 'failed';
            j.error = 'Task completed without supported media outputs.';
          }
          if (j.status === 'completed') j.error = undefined;
          saveJob(j);
        } catch (e) {
          j.error = `Status temporarily unavailable: ${(e as Error).message}`;
          saveJob(j);
        }
      }
      for (const j of allJobs().filter(
        (j) => j.mode === 'kaggle' && j.status === 'running' && (j.leaseUntil ?? 0) < Date.now(),
      ))
        saveJob({
          ...j,
          status: 'interrupted',
          error:
            'Worker lease expired. No automatic retry. Inspect notebook before submitting a new take.',
        });
    } finally {
      ticking = false;
    }
  }, 3000);
  timer.unref();
  const queueTimer = setInterval(pumpQueue, 1000);
  queueTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    clearInterval(queueTimer);
    db.close();
  });
  app.post('/api/studio/worker/claim', async (req, reply) => {
    if (!workerAuth(req, reply)) return;
    const worker = String((req.body as any)?.worker ?? '');
    if (!/^[\w.-]{1,80}$/.test(worker))
      return reply.code(400).send({ error: 'Invalid worker name' });
    touchWorker(db, worker);
    const j = allJobs()
      .reverse()
      .find((j) => j.mode === 'kaggle' && j.status === 'queued');
    if (!j) return { job: null };
    j.status = 'running';
    j.worker = worker;
    j.lease = randomUUID();
    j.leaseUntil = Date.now() + 120000;
    saveJob(j);
    return { job: j };
  });
  app.post('/api/studio/worker/:id', async (req, reply) => {
    if (!workerAuth(req, reply)) return;
    const j = getJob((req.params as any).id),
      b = req.body as any;
    if (
      !j ||
      j.mode !== 'kaggle' ||
      j.status !== 'running' ||
      j.lease !== b.lease ||
      (j.leaseUntil ?? 0) < Date.now()
    )
      return reply.code(409).send({ error: 'Worker lease is no longer valid' });
    if (j.worker) touchWorker(db, j.worker);
    if (b.status && !['running', 'completed', 'failed'].includes(b.status))
      return reply.code(400).send({ error: 'Invalid worker status' });
    if (
      b.status === 'completed' &&
      (!Array.isArray(b.outputs) ||
        !b.outputs.length ||
        b.outputs.some(
          (u: unknown) => typeof u !== 'string' || !u.startsWith('/api/studio/artifacts/'),
        ))
    )
      return reply
        .code(400)
        .send({ error: 'Upload outputs to the studio before completing the job' });
    j.leaseUntil = Date.now() + 120000;
    j.status = b.status ?? 'running';
    j.error = b.error;
    j.outputs = b.outputs ?? j.outputs;
    saveJob(j);
    return { ok: true };
  });
  // Workers return bytes, not Kaggle-local paths or expiring tunnel URLs.
  app.put('/api/studio/worker/:id/artifact/:name', async (req, reply) => {
    if (!workerAuth(req, reply)) return;
    const { id, name } = req.params as any,
      j = getJob(id);
    if (
      !j ||
      j.mode !== 'kaggle' ||
      j.status !== 'running' ||
      j.lease !== req.headers['x-worker-lease'] ||
      (j.leaseUntil ?? 0) < Date.now()
    )
      return reply.code(409).send({ error: 'Invalid lease' });
    if (!/^[\w.-]+\.(png|jpe?g|webp|mp4|webm|wav|mp3|flac|gif)$/i.test(name))
      return reply.code(400).send({ error: 'Unsupported artifact filename' });
    const b = req.body as any;
    if (typeof b?.base64 !== 'string' || b.base64.length > 60000000)
      return reply.code(400).send({ error: 'Artifact must be base64, at most 45 MB' });
    const { writeFileSync } = await import('node:fs');
    const dir = join(config.dataDir, 'studio-artifacts', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), Buffer.from(b.base64, 'base64'));
    return { url: `/api/studio/artifacts/${id}/${name}` };
  });
  app.get('/api/studio/artifacts/:id/:name', async (req, reply) => {
    const { id, name } = req.params as any;
    if (!/^[\w-]+$/.test(id) || !/^[\w.-]+$/.test(name))
      return reply.code(400).send({ error: 'Invalid path' });
    const path = join(config.dataDir, 'studio-artifacts', id, name);
    if (!existsSync(path)) return reply.code(404).send({ error: 'Artifact not found' });
    const { createReadStream } = await import('node:fs');
    const ext = name.split('.').pop().toLowerCase();
    const types: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
    };
    return reply.type(types[ext] ?? 'application/octet-stream').send(createReadStream(path));
  });
}
