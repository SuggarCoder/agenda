import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(
  new URL('../.cache/ms-playwright', import.meta.url),
);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)),
    'install',
    'chromium',
  ],
  { stdio: 'inherit', windowsHide: true, env: process.env },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
