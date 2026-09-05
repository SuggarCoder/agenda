import '../apps/api/src/env.js';
import { connectDatabase } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { createApp } from '../apps/api/src/app.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !/^agenda_test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1)))
  throw new Error('E2E 服务仅允许连接独立测试数据库');
const db = connectDatabase(url);
await migrate(db);
const app = await createApp(db, { origin: 'http://127.0.0.1:4173', serveWeb: true });
// Let the runner release the server without relying on Windows process-tree termination.
// This endpoint exists only in this isolated test server, never in the application entrypoint.
app.post('/__e2e/shutdown', async (request, reply) => {
  if (request.headers['x-agenda-test-control'] !== 'local-e2e') return reply.code(403).send();
  setTimeout(async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  }, 50);
  return { ok: true };
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  });
await app.listen({ port: 4173, host: '127.0.0.1' });
