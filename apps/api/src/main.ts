import { readEnv } from './env.js';
import { connectDatabase } from './db/index.js';
import { createApp } from './app.js';
const env = readEnv();
const db = connectDatabase(env.DATABASE_URL);
const app = await createApp(db, {
  origin: env.APP_ORIGIN,
  production: env.NODE_ENV === 'production',
  logger: true,
  serveWeb: true,
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  });
try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  await db.destroy();
  process.exit(1);
}
