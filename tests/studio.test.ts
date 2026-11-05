import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Fastify from 'fastify';
import { registerStudio, normalizeResult, prepareGraph } from '../server/studio.js';
import { config } from '../server/config.js';
import Database from 'better-sqlite3';
import { inspectGraph, registerStudioTools } from '../server/studio-tools.js';

const parent = resolve('work/studio-tests');
mkdirSync(parent, { recursive: true });
async function setup(t: test.TestContext) {
  const folder = mkdtempSync(join(parent, 'test-'));
  config.dataDir = folder;
  process.env.OPENHIGGS_WORKER_TOKEN = 'test-token-with-at-least-24-characters';
  const app = Fastify({ bodyLimit: 64 * 1024 * 1024 });
  registerStudio(app);
  await app.ready();
  t.after(async () => {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  });
  return app;
}
const graph = { '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt' } } };
test('workflow binding changes exactly the selected input and rejects visual format', () => {
  assert.equal(
    prepareGraph(graph, 'new prompt', { node: '1', field: 'text' })['1'].inputs.text,
    'new prompt',
  );
  assert.equal(graph['1'].inputs.text, 'old prompt');
  assert.throws(() => prepareGraph({ nodes: [] }, 'x'), /API-format/);
  assert.throws(
    () => prepareGraph(graph, 'x', { node: 'missing', field: 'text' }),
    /does not exist/,
  );
});
test('provider result normalization handles success and terminal deletion', () => {
  assert.deepEqual(
    normalizeResult('wavespeed', {
      data: { status: 'completed', outputs: ['https://example.test/a.png'] },
    }).outputs,
    ['https://example.test/a.png'],
  );
  assert.equal(normalizeResult('wavespeed', { data: { status: 'deleted' } }).status, 'failed');
  assert.equal(normalizeResult('wavespeed', { data: { status: 'processing' } }).status, 'running');
  assert.equal(
    normalizeResult('kie', { data: { state: 'fail', failMsg: 'credit exhausted' } }).error,
    'credit exhausted',
  );
  assert.deepEqual(
    normalizeResult('kie', {
      data: { state: 'success', resultJson: '{"resultUrls":["https://example.test/b.mp4"]}' },
    }).outputs,
    ['https://example.test/b.mp4'],
  );
});
test('project persistence, validation and cross-origin rejection', async (t) => {
  const app = await setup(t);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/studio/projects/p',
        payload: { id: 'q', name: 'Film', shots: [] },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/studio/projects/p',
        payload: { id: 'p', name: 'Film', shots: [] },
      })
    ).statusCode,
    200,
  );
  assert.equal((await app.inject('/api/studio/projects')).json()[0].name, 'Film');
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/studio/projects/p',
        headers: { origin: 'https://evil.example' },
        payload: { id: 'p', name: 'X', shots: [] },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/studio/projects/p',
        headers: { origin: 'null' },
        payload: { id: 'p', name: 'X', shots: [] },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/studio/projects/p',
        headers: { host: `localhost:${config.port}`, origin: `http://localhost:${config.uiPort}` },
        payload: { id: 'p', name: 'Dev proxy works', shots: [] },
      })
    ).statusCode,
    200,
  );
});
test('Kaggle claims are exclusive, leases authenticate artifacts and completion persists', async (t) => {
  const app = await setup(t),
    auth = { authorization: 'Bearer ' + process.env.OPENHIGGS_WORKER_TOKEN };
  await app.inject({
    method: 'PUT',
    url: '/api/studio/projects/p',
    payload: { id: 'p', name: 'Film', shots: [] },
  });
  const created = await app.inject({
    method: 'POST',
    url: '/api/studio/jobs',
    payload: {
      projectId: 'p',
      shotId: 's',
      prompt: 'rain',
      mode: 'kaggle',
      payload: { workflow: graph, binding: { node: '1', field: 'text' } },
    },
  });
  assert.equal(created.statusCode, 202);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/studio/worker/claim',
        payload: { worker: 't4-0' },
      })
    ).statusCode,
    401,
  );
  const first = (
    await app.inject({
      method: 'POST',
      url: '/api/studio/worker/claim',
      headers: auth,
      payload: { worker: 't4-0' },
    })
  ).json().job;
  assert.equal(first.payload.workflow['1'].inputs.text, 'rain');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/studio/worker/claim',
        headers: auth,
        payload: { worker: 't4-1' },
      })
    ).json().job,
    null,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/studio/worker/' + first.id,
        headers: auth,
        payload: { lease: 'wrong', status: 'completed', outputs: ['https://bad.example'] },
      })
    ).statusCode,
    409,
  );
  const artifact = '/api/studio/worker/' + first.id + '/artifact/frame.png';
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: artifact,
        headers: auth,
        payload: { base64: 'aGVsbG8=' },
      })
    ).statusCode,
    409,
  );
  const uploaded = await app.inject({
    method: 'PUT',
    url: artifact,
    headers: { ...auth, 'x-worker-lease': first.lease },
    payload: { base64: 'aGVsbG8=' },
  });
  assert.equal(uploaded.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/studio/worker/' + first.id,
        headers: auth,
        payload: { lease: first.lease, status: 'completed', outputs: [] },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/studio/worker/' + first.id,
        headers: auth,
        payload: { lease: first.lease, status: 'completed', outputs: [uploaded.json().url] },
      })
    ).statusCode,
    200,
  );
  assert.equal((await app.inject('/api/studio/jobs')).json()[0].status, 'completed');
  assert.equal((await app.inject(uploaded.json().url)).body, 'hello');
});
test('WaveSpeed and Kie submissions use documented payloads, save task IDs, and never retry ambiguous submissions', async (t) => {
  const app = await setup(t);
  process.env.WAVESPEED_API_KEY = 'test-wavespeed';
  process.env.KIE_API_KEY = 'test-kie';
  await app.inject({
    method: 'PUT',
    url: '/api/studio/projects/p',
    payload: { id: 'p', name: 'Film', shots: [] },
  });
  const calls: { url: string; payload: any }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    calls.push({ url: String(url), payload: JSON.parse(init.body) });
    if (String(url).includes('ambiguous')) throw new Error('connection dropped');
    return new Response(
      JSON.stringify({
        code: 200,
        data: String(url).includes('kie.ai') ? { taskId: 'kie-id' } : { id: 'wave-id' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  for (const mode of ['wavespeed', 'kie']) {
    await app.inject({
      method: 'POST',
      url: '/api/studio/jobs',
      payload: {
        projectId: 'p',
        shotId: mode,
        prompt: 'A cinematic frame',
        mode,
        model: 'vendor/model',
        payload: { input: { aspect_ratio: '16:9' } },
      },
    });
  }
  await new Promise((r) => setTimeout(r, 30));
  const js = (await app.inject('/api/studio/jobs')).json();
  assert.equal(js.find((j: any) => j.mode === 'wavespeed').remoteId, 'wave-id');
  assert.equal(js.find((j: any) => j.mode === 'kie').remoteId, 'kie-id');
  assert.equal(calls[0].payload.prompt, 'A cinematic frame');
  assert.deepEqual(calls[1].payload, {
    model: 'vendor/model',
    input: { aspect_ratio: '16:9', prompt: 'A cinematic frame' },
  });
  await app.inject({
    method: 'POST',
    url: '/api/studio/jobs',
    payload: {
      projectId: 'p',
      shotId: 'unknown',
      prompt: 'frame',
      mode: 'wavespeed',
      model: 'vendor/ambiguous',
      payload: { input: {} },
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(
    (await app.inject('/api/studio/jobs')).json().find((j: any) => j.shotId === 'unknown').status,
    'unknown',
  );
  assert.equal(calls.filter((c) => c.url.includes('ambiguous')).length, 1);
  delete process.env.WAVESPEED_API_KEY;
  delete process.env.KIE_API_KEY;
});
test('missing credentials and invalid workflows do not create jobs', async (t) => {
  const app = await setup(t);
  delete process.env.WAVESPEED_API_KEY;
  await app.inject({
    method: 'PUT',
    url: '/api/studio/projects/p',
    payload: { id: 'p', name: 'Film', shots: [] },
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/studio/jobs',
        payload: {
          projectId: 'p',
          shotId: 's',
          prompt: 'frame',
          mode: 'wavespeed',
          model: 'vendor/model',
          payload: { input: {} },
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/studio/jobs',
        payload: {
          projectId: 'p',
          shotId: 's',
          prompt: 'frame',
          mode: 'local',
          payload: { workflow: { nodes: [] } },
        },
      })
    ).statusCode,
    400,
  );
  assert.deepEqual((await app.inject('/api/studio/jobs')).json(), []);
});
test('workflow inspection follows positive conditioning and Freefield prompt bindings', async (t) => {
  const app = await setup(t);
  const inspected = inspectGraph({
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'negative' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'positive' } },
    '3': { class_type: 'KSampler', inputs: { positive: ['2', 0], seed: 3 } },
  });
  assert.deepEqual(inspected.binding, { node: '2', field: 'text' });
  const settings = await app.inject(
    '/api/studio/workflows/freefield--apps_create-image_workflow_api/settings',
  );
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.json().binding.node, '18:17');
  assert.equal(settings.json().binding.field, 'value');
});
test('preflight reports missing nodes, unavailable model files, and broken graph links', async (t) => {
  const app = await setup(t);
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          CheckpointLoaderSimple: {
            input: { required: { ckpt_name: [['installed.safetensors']] } },
          },
        }),
        { status: 200 },
      ),
  );
  const result = (
    await app.inject({
      method: 'POST',
      url: '/api/studio/preflight',
      payload: {
        mode: 'local',
        workflow: {
          '1': {
            class_type: 'CheckpointLoaderSimple',
            inputs: { ckpt_name: 'missing.safetensors' },
          },
          '2': { class_type: 'MissingNode', inputs: { image: ['404', 0] } },
        },
      },
    })
  ).json();
  assert.equal(result.ready, false);
  assert.deepEqual(result.missingNodes, ['MissingNode']);
  assert.equal(result.invalidValues[0].value, 'missing.safetensors');
  assert.equal(result.brokenLinks.length, 1);
  assert.deepEqual(result.fields[0].options, ['installed.safetensors']);
});
test('uploaded media requires a valid graph binding and workers cannot download without a token', async (t) => {
  const app = await setup(t);
  const asset = (
    await app.inject({
      method: 'POST',
      url: '/api/studio/assets',
      payload: { name: 'input.png', base64: 'aGVsbG8=' },
    })
  ).json();
  assert.equal((await app.inject('/api/studio/worker/assets/' + asset.id)).statusCode, 401);
  const response = await app.inject({
    method: 'GET',
    url: '/api/studio/worker/assets/' + asset.id,
    headers: { authorization: 'Bearer ' + process.env.OPENHIGGS_WORKER_TOKEN },
  });
  assert.equal(response.body, 'hello');
  await app.inject({
    method: 'PUT',
    url: '/api/studio/projects/p',
    payload: { id: 'p', name: 'Film', shots: [] },
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/studio/jobs',
        payload: {
          projectId: 'p',
          shotId: 's',
          mode: 'kaggle',
          prompt: 'frame',
          payload: { workflow: graph, assets: [{ id: asset.id, node: 'missing', field: 'image' }] },
        },
      })
    ).statusCode,
    400,
  );
});
test('archiving a completed take persists bytes and replaces the expiring media URL', async (t) => {
  const folder = mkdtempSync(join(parent, 'archive-'));
  config.dataDir = folder;
  const app = Fastify(),
    db = new Database(':memory:');
  const job: any = {
    id: 'archive-test',
    status: 'completed',
    outputs: ['https://media.example.test/temporary.png'],
  };
  registerStudioTools(
    app,
    {
      db,
      getJob: (id) => (id === job.id ? job : undefined),
      saveJob: (value) => Object.assign(job, value),
    },
    () => true,
  );
  t.after(async () => {
    await app.close();
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('png-bytes', { headers: { 'Content-Type': 'image/png' } });
  });
  const result = await app.inject({
    method: 'POST',
    url: '/api/studio/jobs/archive-test/archive',
    payload: {},
  });
  assert.equal(result.statusCode, 200);
  assert.equal(job.archived, true);
  assert.equal(job.outputs[0], '/api/studio/artifacts/archive-test/saved-0.png');
  const { readFileSync } = await import('node:fs');
  assert.equal(
    readFileSync(join(folder, 'studio-artifacts/archive-test/saved-0.png'), 'utf8'),
    'png-bytes',
  );
  await app.inject({ method: 'POST', url: '/api/studio/jobs/archive-test/archive', payload: {} });
  assert.equal(calls, 1);
});
test('batch validation is atomic and an idempotency key cannot create duplicate takes', async (t) => {
  const app = await setup(t);
  await app.inject({
    method: 'PUT',
    url: '/api/studio/projects/p',
    payload: { id: 'p', name: 'Batch film', shots: [] },
  });
  const item = {
    projectId: 'p',
    shotId: 'first',
    mode: 'kaggle',
    prompt: 'A frame',
    payload: { workflow: graph },
  };
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/studio/jobs/batch',
    payload: { jobs: [item, { ...item, shotId: 'second', payload: { workflow: { nodes: [] } } }] },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await app.inject('/api/studio/jobs')).json().length, 0);
  const payload = {
    idempotencyKey: 'batch-request-001',
    jobs: [item, { ...item, shotId: 'second' }],
  };
  const first = await app.inject({ method: 'POST', url: '/api/studio/jobs/batch', payload });
  const replay = await app.inject({ method: 'POST', url: '/api/studio/jobs/batch', payload });
  assert.equal(first.statusCode, 202);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replayed, true);
  assert.deepEqual(
    first.json().jobs.map((j: any) => j.id),
    replay.json().jobs.map((j: any) => j.id),
  );
  assert.equal((await app.inject('/api/studio/jobs')).json().length, 2);
  const collision = await app.inject({
    method: 'POST',
    url: '/api/studio/jobs/batch',
    payload: { ...payload, jobs: [{ ...item, prompt: 'A different frame' }] },
  });
  assert.equal(collision.statusCode, 409);
});
test('paid queue limits submissions and cancellation never contacts an upstream provider', async (t) => {
  const app = await setup(t);
  process.env.WAVESPEED_API_KEY = 'test-queue-key';
  t.after(() => delete process.env.WAVESPEED_API_KEY);
  await app.inject({
    method: 'PUT',
    url: '/api/studio/projects/p',
    payload: { id: 'p', name: 'Batch film', shots: [] },
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => {
    calls++;
    return new Promise(() => {});
  });
  const item = {
    projectId: 'p',
    mode: 'wavespeed',
    model: 'vendor/model',
    prompt: 'Frame',
    payload: { input: {} },
  };
  const result = (
    await app.inject({
      method: 'POST',
      url: '/api/studio/jobs/batch',
      payload: { jobs: [1, 2, 3, 4].map((i) => ({ ...item, shotId: String(i) })) },
    })
  ).json();
  assert.equal(calls, 2);
  assert.equal(result.jobs.filter((j: any) => j.status === 'queued').length, 2);
  const waiting = result.jobs.find((j: any) => j.status === 'queued');
  const cancel = await app.inject({
    method: 'POST',
    url: `/api/studio/jobs/${waiting.id}/cancel`,
    payload: {},
  });
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.json().status, 'cancelled');
  assert.equal(calls, 2);
  const active = result.jobs.find((j: any) => j.status === 'submitting');
  assert.equal(
    (await app.inject({ method: 'POST', url: `/api/studio/jobs/${active.id}/cancel`, payload: {} }))
      .statusCode,
    409,
  );
});
test('canceled Kaggle takes are not handed to workers', async (t) => {
  const app = await setup(t);
  await app.inject({
    method: 'PUT',
    url: '/api/studio/projects/p',
    payload: { id: 'p', name: 'Film', shots: [] },
  });
  const job = (
    await app.inject({
      method: 'POST',
      url: '/api/studio/jobs',
      payload: {
        projectId: 'p',
        shotId: 's',
        mode: 'kaggle',
        prompt: 'Frame',
        payload: { workflow: graph },
      },
    })
  ).json();
  await app.inject({ method: 'POST', url: `/api/studio/jobs/${job.id}/cancel`, payload: {} });
  const claimed = await app.inject({
    method: 'POST',
    url: '/api/studio/worker/claim',
    headers: { authorization: 'Bearer ' + process.env.OPENHIGGS_WORKER_TOKEN },
    payload: { worker: 'test-t4' },
  });
  assert.equal(claimed.json().job, null);
});
test('task recovery resumes tracking without resubmitting a generation', async (t) => {
  const app = await setup(t);
  process.env.KIE_API_KEY = 'test-recovery-key';
  t.after(() => delete process.env.KIE_API_KEY);
  await app.inject({
    method: 'PUT',
    url: '/api/studio/projects/p',
    payload: { id: 'p', name: 'Film', shots: [] },
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    throw new Error('Lost response');
  });
  const job = (
    await app.inject({
      method: 'POST',
      url: '/api/studio/jobs',
      payload: {
        projectId: 'p',
        shotId: 's',
        mode: 'kie',
        model: 'vendor/model',
        prompt: 'Frame',
        payload: { input: {} },
      },
    })
  ).json();
  await new Promise((r) => setTimeout(r, 10));
  const recovered = await app.inject({
    method: 'POST',
    url: `/api/studio/jobs/${job.id}/recover`,
    payload: { remoteId: 'existing-provider-task' },
  });
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.json().remoteId, 'existing-provider-task');
  assert.equal(recovered.json().status, 'running');
  assert.equal(calls, 1);
});
