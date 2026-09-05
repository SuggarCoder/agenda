import { readEnv } from './env.js';
import { connectDatabase } from './db/index.js';
import { migrate } from './db/migrate.js';

const db = connectDatabase(readEnv().DATABASE_URL);
try {
  const results = await migrate(db);
  console.log(results.length ? results : 'Database is up to date.');
} finally {
  await db.destroy();
}
