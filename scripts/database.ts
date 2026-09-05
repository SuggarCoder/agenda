import '../apps/api/src/env.js';
import { connectDatabase } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { sql } from 'kysely';
import pg from 'pg';

const mode = process.argv[2];
if (!['migrate', 'reset', 'test-prepare'].includes(mode))
  throw new Error('Use migrate, reset, or test-prepare');
const url = process.env[mode === 'test-prepare' ? 'TEST_DATABASE_URL' : 'DATABASE_URL'];
if (!url) throw new Error('请先配置 .env 中的数据库连接');
const target = decodeURIComponent(new URL(url).pathname.slice(1));
if (mode === 'test-prepare') {
  if (!/^agenda_test_[a-z0-9_]+$/.test(target))
    throw new Error('测试数据库必须以 agenda_test_ 开头，禁止使用业务库');
  const bootstrap = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await bootstrap.connect();
  try {
    const exists = await bootstrap.query('SELECT 1 FROM pg_database WHERE datname = $1', [target]);
    if (!exists.rowCount) await bootstrap.query(`CREATE DATABASE "${target}"`);
  } finally {
    await bootstrap.end();
  }
}
const db = connectDatabase(url);
try {
  if (mode === 'reset') {
    if (target !== 'agenda') throw new Error('重置命令仅允许用于 agenda 数据库');
    await db.transaction().execute(async (tx) => {
      const info = await sql<{ name: string }>`SELECT current_database() AS name`.execute(tx);
      if (info.rows[0].name !== 'agenda') throw new Error('数据库名称校验失败');
      // Extension-owned objects are retained. Only public application objects are reset.
      await sql
        .raw(
          `DO $$ DECLARE obj record; BEGIN
        FOR obj IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
          AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
        LOOP EXECUTE format('DROP %s IF EXISTS public.%I CASCADE', CASE obj.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, obj.relname); END LOOP;
        FOR obj IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
        LOOP EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', obj.proname, obj.args); END LOOP;
        FOR obj IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname='public' AND t.typtype IN ('e','d') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')
        LOOP EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', obj.typname); END LOOP;
      END $$;`,
        )
        .execute(tx);
    });
    console.log('agenda 业务表及迁移记录已重置。');
  }
  const results = await migrate(db);
  console.log(
    `${target}: ${results.length ? results.map((r) => `${r.migrationName} ${r.status}`).join(', ') : '数据库已是最新版本'}`,
  );
} finally {
  await db.destroy();
}
