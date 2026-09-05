import { readFile } from 'node:fs/promises';
import { sql, Migrator, type Kysely } from 'kysely';
import { hash } from 'argon2';
import type { Db } from './index.js';

export async function migrate(db: Db) {
  const migrator = new Migrator({
    db,
    provider: {
      async getMigrations() {
        return {
          '001_initial': {
            async up(database: Kysely<unknown>) {
              await sql
                .raw(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
                .execute(database);
              await sql`INSERT INTO users(username,password_hash,name,role,must_change_password)
        VALUES('mkmAdmin',${await hash('mkmAdmin')},'管理员','admin',false)`.execute(database);
            },
          },
        };
      },
    },
  });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
  return result.results ?? [];
}
