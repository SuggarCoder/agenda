import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import type { Db } from './db/index.js';
import { registerAuth } from './auth.js';
import { registerCatalog } from './catalog.js';
import { registerAttendance } from './attendance.js';
import { registerReports } from './reports.js';
import { installErrors } from './errors.js';
import { rootDir } from './env.js';

export async function createApp(
  db: Db,
  options: { origin?: string; production?: boolean; logger?: boolean; serveWeb?: boolean } = {},
) {
  const app = Fastify({
    // Production has exactly one private nginx hop, which overwrites forwarded headers.
    trustProxy: options.production ? (_address, hop) => hop === 0 : false,
    logger: options.logger
      ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] }
      : false,
    bodyLimit: 65536,
  });
  installErrors(app);
  app.addHook('onSend', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'same-origin');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (options.production)
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
  });
  await registerAuth(app, db, options.origin ?? 'http://localhost:5173', !!options.production);
  app.get('/api/health', async () => {
    await sql`SELECT 1`.execute(db);
    return { ok: true };
  });
  registerCatalog(app, db);
  registerAttendance(app, db);
  registerReports(app, db);
  const webRoot = resolve(rootDir, 'apps/web/dist');
  if (options.serveWeb && existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.url.startsWith('/api/') ||
        !['GET', 'HEAD'].includes(req.method) ||
        /\.[a-z0-9]+(?:\?|$)/i.test(req.url)
      )
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '页面或接口不存在' } });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
