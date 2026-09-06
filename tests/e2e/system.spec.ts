import '../../apps/api/src/env.js';
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { connectDatabase } from '../../apps/api/src/db/index.js';

async function login(page: Page, username = 'mkmAdmin', password = 'mkmAdmin') {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}
async function go(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: label, exact: true })
    .click();
}
async function saveDialog(page: Page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('管理员建档排课 → 教师首次改密 → 课后考勤、更正、审计和 CSV', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tag = randomUUID().slice(0, 6);
  const campus = `南城校区-${tag}`,
    course = `创意美术-${tag}`,
    className = `周末启蒙班-${tag}`,
    student = `林小禾-${tag}`,
    teacher = `陈老师-${tag}`,
    username = `e2e_${tag}`;
  await login(page);
  await expect(page.getByRole('heading', { name: '管理员，你好' })).toBeVisible();
  await go(page, '校区管理');
  await page.getByRole('button', { name: '新建校区', exact: true }).click();
  await page.getByLabel('校区名称').fill(campus);
  await saveDialog(page);
  await expect(page.getByRole('cell', { name: campus, exact: true })).toBeVisible();
  await go(page, '课程管理');
  await page.getByRole('button', { name: '新建课程', exact: true }).click();
  await page.getByLabel('课程名称').fill(course);
  await saveDialog(page);
  await go(page, '学员档案');
  await page.getByRole('button', { name: '新建学员', exact: true }).click();
  await page.getByLabel('学员姓名').fill(student);
  await page.getByLabel('联系电话').fill('13800138000');
  await page.getByLabel('监护人姓名').fill('林女士');
  await page.getByLabel('监护人关系').selectOption('mother');
  await saveDialog(page);
  await go(page, '教师账号');
  await page.getByRole('button', { name: '新建教师', exact: true }).click();
  await page.getByLabel('用户名', { exact: false }).fill(username);
  await page.getByLabel('姓名', { exact: false }).fill(teacher);
  await page.getByLabel('手机号').fill('13900139000');
  await page.getByLabel('教师角色').selectOption('homeroom_teacher');
  await saveDialog(page);
  await go(page, '班级管理');
  await page.getByRole('button', { name: '新建班级', exact: true }).click();
  await page.getByLabel('班级名称').fill(className);
  await page.getByLabel('所属校区').selectOption({ label: campus });
  await page.getByLabel('所属课程').selectOption({ label: course });
  await saveDialog(page);
  await page
    .getByRole('link', { name: new RegExp(className) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: className, exact: true })).toBeVisible();
  const classId = page.url().split('/').pop()!;
  await page.getByRole('button', { name: '分配', exact: true }).first().click();
  await page.getByLabel('选择教师').selectOption({ label: teacher });
  await saveDialog(page);
  await page.getByRole('button', { name: '添加学员', exact: true }).click();
  await page.getByLabel('选择学员').selectOption({ label: student });
  await saveDialog(page);
  await expect(page.getByRole('cell', { name: student, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建时段', exact: true }).click();
  await saveDialog(page);
  await expect(page.getByText('下课后开放', { exact: true })).toBeVisible();
  // Simulate this newly created class finishing, only in the guarded test database.
  // Enrollment history stays unchanged; the session begins after enrollment.
  const url = process.env.TEST_DATABASE_URL!;
  expect(new URL(url).pathname).toMatch(/^\/agenda_test_/);
  const db = connectDatabase(url);
  try {
    await sql`UPDATE attendance_sessions SET starts_at=(SELECT max(joined_at)+interval '1 millisecond' FROM class_enrollments WHERE class_id=${classId}),ends_at=now()-interval '1 millisecond' WHERE class_id=${classId}`.execute(
      db,
    );
  } finally {
    await db.destroy();
  }
  await page.locator('.user-menu summary').click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录教务空间' })).toBeVisible();
  await login(page, username, 'Admin@123');
  await expect(page.getByRole('heading', { name: '先设置你的专属密码' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByLabel('原密码', { exact: true }).fill('Admin@123');
  await page.getByLabel('新密码', { exact: true }).fill('Teacher@123');
  await page.getByLabel('确认新密码', { exact: true }).fill('Teacher@123');
  await page.getByRole('button', { name: '保存新密码' }).click();
  await expect(page.getByRole('heading', { name: '登录教务空间' })).toBeVisible();
  await login(page, username, 'Teacher@123');
  await expect(page.getByRole('heading', { name: `${teacher}，你好` })).toBeVisible();
  await expect(page.getByRole('link', { name: '教师账号', exact: true })).toHaveCount(0);
  await go(page, '考勤时段');
  await page.getByRole('link', { name: '处理考勤', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: className, exact: true })).toBeVisible();
  const row = page.locator('.roster-entry').filter({ hasText: student });
  const rosterSearch = page.getByRole('textbox', { name: '搜索本次学员' });
  await rosterSearch.focus();
  await rosterSearch.dispatchEvent('compositionstart');
  await rosterSearch.evaluate((el: HTMLInputElement) => {
    el.value = 'lin';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  });
  await expect(row).toBeVisible();
  await rosterSearch.evaluate((el: HTMLInputElement, name) => {
    el.value = name;
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: name }));
  }, student);
  await expect(row).toBeVisible();
  let releaseRoster!: () => void;
  const rosterGate = new Promise<void>((resolve) => (releaseRoster = resolve));
  const rosterUrl = `**/api/attendance-sessions/${page.url().split('/').pop()}/attendance`;
  await page.route(rosterUrl, async (route) => {
    await rosterGate;
    await route.continue();
  });
  const refreshed = page.waitForResponse((r) => r.url().endsWith('/attendance'));
  // Focus before the refresh response so losing focus cannot be masked by auto-waiting.
  await rosterSearch.evaluate((el: HTMLInputElement) => {
    const button = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('刷新名单'),
    )!;
    button.click();
    el.focus();
  });
  try {
    await expect(rosterSearch).toBeFocused({ timeout: 1000 });
    await expect(rosterSearch).toHaveValue(student);
  } finally {
    releaseRoster();
  }
  await refreshed;
  await expect(rosterSearch).toBeFocused();
  await expect(rosterSearch).toHaveValue(student);
  await page.unroute(rosterUrl);
  await row.getByRole('button', { name: '出勤', exact: true }).click();
  await expect(row.getByRole('button', { name: '出勤', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await row.getByRole('button', { name: '缺勤', exact: true }).click();
  await expect(row.getByRole('button', { name: '缺勤', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('本次考勤已完成', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '班级审计', exact: true }).click();
  await expect(page.getByText('首次录入', { exact: true })).toBeVisible();
  await expect(page.getByText('更正考勤', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(student) })).toHaveCount(2);
  await go(page, '考勤报表');
  await page.getByRole('combobox', { name: '校区筛选' }).selectOption({ label: campus });
  await page.getByRole('button', { name: /^教师汇总/ }).click();
  const teacherRow = page.getByRole('row').filter({ hasText: teacher });
  await expect(teacherRow).toBeVisible();
  await expect(teacherRow).toContainText('100%');
  await expect(page.getByRole('columnheader', { name: '录入完成率', exact: true })).toBeVisible();
  const summaryDownloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出教师汇总', exact: true }).click();
  const summaryFile = await summaryDownloading;
  const summaryStream = await summaryFile.createReadStream();
  const summaryChunks: Buffer[] = [];
  if (summaryStream)
    for await (const chunk of summaryStream) summaryChunks.push(Buffer.from(chunk));
  const summaryContents = Buffer.concat(summaryChunks).toString('utf8');
  expect(summaryContents).toContain(teacher);
  expect(summaryContents).toContain('录入完成率');
  expect(summaryContents).toContain('100%');
  await page.getByRole('button', { name: '关闭提示' }).evaluateAll((buttons) => {
    for (const button of buttons) (button as HTMLButtonElement).click();
  });
  await page.screenshot({
    path: testInfo.outputPath('teacher-report-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: '主导航' })).not.toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('teacher-report-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await teacherRow.getByRole('button', { name: '查看学员明细' }).click();
  await expect(page.getByRole('combobox', { name: '教师角色筛选' })).toHaveValue(
    'homeroom_teacher',
  );
  await expect(
    page.getByRole('combobox', { name: '归属教师筛选' }).locator('option:checked'),
  ).toContainText(teacher);
  await expect(page.getByRole('cell', { name: new RegExp(student) })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const file = await downloading;
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  if (stream) for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const contents = Buffer.concat(chunks).toString('utf8');
  expect(contents).toContain(student);
  expect(contents).toContain('缺勤');
  expect(contents).toContain(teacher);
  await page.getByRole('combobox', { name: '教师角色筛选' }).selectOption('subject_teacher');
  await expect(page.getByRole('combobox', { name: '归属教师筛选' })).toHaveValue('');
  await expect(page.getByText('暂无考勤明细', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '教师角色筛选' }).selectOption('');
  await expect(page.getByRole('cell', { name: new RegExp(student) })).toBeVisible();
  await go(page, '每周预警');
  await expect(page.getByRole('cell', { name: student, exact: true })).toBeVisible();
  await go(page, '工作台');
  await expect(page.locator('.stat-card').first()).toContainText('1');
  await page.screenshot({ path: testInfo.outputPath('teacher-dashboard.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('手机端可以登录、使用导航和查看班级，页面无横向溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('heading', { name: '管理员，你好' })).toBeVisible();
  await expect(page.getByRole('navigation')).not.toBeInViewport();
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('navigation')).toBeInViewport();
  await go(page, '班级管理');
  await expect(page.getByRole('heading', { name: '班级管理', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).not.toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('mobile-classes.png'), fullPage: true });
});
test('登录错误可见，未登录深层链接跳转到登录页', async ({ page }, testInfo) => {
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: '登录教务空间' })).toBeVisible();
  await page.getByLabel('用户名', { exact: true }).fill('nobody');
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('用户名或密码错误');
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
});

test('提前直达考勤页被拒绝后，仍可正常切换到工作台', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: '管理员，你好' })).toBeVisible();
  const lookups = await (await page.request.get('/api/lookups')).json();
  const cl = lookups.classes.find((item: { archived_at: string | null }) => !item.archived_at);
  expect(cl).toBeTruthy();
  const response = await page.request.post('/api/attendance-sessions', {
    headers: { origin: 'http://127.0.0.1:4173' },
    data: {
      class_id: cl.id,
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
    },
  });
  expect(response.status()).toBe(201);
  const session = await response.json();
  try {
    await page.goto(`/attendance/${session.id}`);
    await expect(page.getByRole('alert')).toContainText('尚未结束');
    await go(page, '工作台');
    await expect(page.getByRole('heading', { name: '管理员，你好' })).toBeVisible();
  } finally {
    await page.request.delete(`/api/attendance-sessions/${session.id}`, {
      headers: { origin: 'http://127.0.0.1:4173' },
    });
  }
});
