/** Isolated host for the Python worker end-to-end test. */
import Fastify from 'fastify';
import { resolve } from 'node:path';
import { config } from '../server/config.js';
import { registerStudio } from '../server/studio.js';
config.dataDir = resolve('work/worker-e2e-data');
process.env.OPENHIGGS_WORKER_TOKEN = 'isolated-e2e-test-token-24-characters';
const app = Fastify({ bodyLimit: 64 * 1024 * 1024 });
registerStudio(app);
await app.listen({ port: 13163, host: '127.0.0.1' });
