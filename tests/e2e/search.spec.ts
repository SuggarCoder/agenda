import { test, expect } from '@playwright/test';

const pages = [
  ['campuses', 'campuses'],
  ['courses', 'courses'],
  ['students', 'students'],
  ['teachers', 'users'],
  ['classes', 'classes'],
  ['sessions', 'attendance-sessions'],
  ['reports', 'reports/attendance'],
  ['warnings', 'weekly-warnings'],
  ['audits', 'audit-logs'],
] as const;

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/auth/login', {
    headers: { origin: 'http://127.0.0.1:4173' },
    data: { username: 'mkmAdmin', password: 'mkmAdmin' },
  });
  expect(response.ok()).toBeTruthy();
});

for (const [path, endpoint] of pages) {
  test(`${path}: 搜索刷新期间保持焦点、光标和连续输入`, async ({ page }) => {
    await page.goto(`/${path}`);
    const input = page.getByRole('textbox', { name: '搜索', exact: true });
    await expect(input).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/${endpoint}?**`, async (route) => {
      if (new URL(route.request().url()).searchParams.get('q') === 'abc') await gate;
      await route.continue();
    });
    const request = page.waitForRequest((r) => new URL(r.url()).searchParams.get('q') === 'abc');
    await input.fill('abc');
    await request;
    const stale = page.waitForResponse((r) => new URL(r.url()).searchParams.get('q') === 'abc');
    try {
      await expect(input).toBeFocused({ timeout: 1000 });
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.type('X');
      await expect(input).toHaveValue('abXc');
      expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3);
      const latest = page.waitForResponse((r) => new URL(r.url()).searchParams.get('q') === 'abXc');
      await latest;
      await expect(input).toBeFocused();
    } finally {
      release();
    }
    await stale;
    await expect(input).toHaveValue('abXc');
    await expect(input).toBeFocused();
    expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3);
    const cleared = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === `/api/${endpoint}` && !url.searchParams.has('q');
    });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await cleared;
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
  });
}

test('筛选条件变化不覆盖尚未提交的搜索文字，中文组词结束后才查询', async ({ page }) => {
  await page.goto('/students');
  const input = page.getByRole('textbox', { name: '搜索', exact: true });
  await expect(input).toBeVisible();
  const searches: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/students' && url.searchParams.has('q'))
      searches.push(url.searchParams.get('q')!);
  });
  // Dispatch the filter change in the same task, before the debounce can commit.
  await input.evaluate((el: HTMLInputElement) => {
    el.value = '待提交';
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLInputElement>('.check-filter input')!.click();
  });
  await expect(input).toHaveValue('待提交');
  await expect.poll(() => searches.includes('待提交')).toBeTruthy();
  await input.focus();
  await input.dispatchEvent('compositionstart');
  await input.evaluate((el: HTMLInputElement) => {
    el.value = 'zhong';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  // Remain in composition beyond the 300 ms debounce window.
  await page.waitForTimeout(450);
  expect(searches).not.toContain('zhong');
  await expect(input).toBeFocused();
  await input.evaluate((el: HTMLInputElement) => {
    el.value = '中文';
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await expect.poll(() => searches.filter((q) => q === '中文').length).toBe(1);
  await expect(input).toHaveValue('中文');
  await expect(input).toBeFocused();
});
