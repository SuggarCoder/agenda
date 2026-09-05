export default async function teardown() {
  try {
    await fetch('http://127.0.0.1:4173/__e2e/shutdown', {
      method: 'POST',
      headers: { 'x-agenda-test-control': 'local-e2e' },
      signal: AbortSignal.timeout(3000),
    });
    // Wait for graceful exit before Playwright's Windows process cleanup runs.
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await fetch('http://127.0.0.1:4173/api/health', { signal: AbortSignal.timeout(300) });
      } catch {
        return;
      }
    }
  } catch {
    /* The server may already have exited after a startup failure. */
  }
}
