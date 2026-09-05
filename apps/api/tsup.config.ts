import { defineConfig } from 'tsup';
import { copyFile } from 'node:fs/promises';
export default defineConfig({
  entry: ['src/main.ts', 'src/migrate.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  splitting: false,
  noExternal: ['@agenda/shared'],
  async onSuccess() {
    await copyFile('src/db/schema.sql', 'dist/schema.sql');
  },
});
