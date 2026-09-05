import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
export const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
config({ path: `${rootDir}/.env`, quiet: true });
export function readEnv() {
  let databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl && process.env.PGHOST) {
    const pg = z
      .object({
        PGHOST: z.string().min(1),
        PGPORT: z.coerce.number().int().min(1).max(65535).default(5432),
        PGDATABASE: z.string().min(1),
        PGUSER: z.string().min(1),
        PGPASSWORD: z.string().min(1),
      })
      .parse(process.env);
    const url = new URL('postgresql://localhost');
    url.hostname = pg.PGHOST;
    url.port = String(pg.PGPORT);
    url.username = encodeURIComponent(pg.PGUSER);
    url.password = encodeURIComponent(pg.PGPASSWORD);
    url.pathname = `/${encodeURIComponent(pg.PGDATABASE)}`;
    databaseUrl = url.href;
  }
  return z
    .object({
      DATABASE_URL: z.string().url(),
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      HOST: z.string().default('127.0.0.1'),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    })
    .parse({ ...process.env, DATABASE_URL: databaseUrl });
}
