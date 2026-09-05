import '../apps/api/src/env.js';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { connectDatabase } from '../apps/api/src/db/index.js';
import { migrate } from '../apps/api/src/db/migrate.js';
import { createApp } from '../apps/api/src/app.js';
import { csv } from '../apps/api/src/helpers.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^agenda_test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1)))
  throw new Error('必须配置独立 TEST_DATABASE_URL，且库名以 agenda_test_ 开头');
const db = connectDatabase(url);
let app: Awaited<ReturnType<typeof createApp>>;
const tag = randomUUID().slice(0, 8);
type Json = Record<string, any>;
let adminCookie: string, homeCookie: string, subjectCookie: string, outsiderCookie: string;
let adminId: string, home: Json, subject: Json, outsider: Json;
let campus1: Json, campus2: Json, course: Json, class1: Json, class2: Json;
let past: { starts_at: string; ends_at: string };
const origin = 'http://localhost:5173';
async function request(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  cookie = adminCookie,
) {
  return app.inject({
    method,
    url: `/api${path}`,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(body !== undefined
      ? {
          payload: JSON.stringify(body),
          headers: { origin, cookie: cookie ?? '', 'content-type': 'application/json' },
        }
      : {}),
  });
}
async function ok(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<Json> {
  const response = await request(method, path, body, cookie);
  assert.ok(
    response.statusCode >= 200 && response.statusCode < 300,
    `${method} ${path}: ${response.statusCode} ${response.body}`,
  );
  return response.json();
}
async function login(username: string, password: string) {
  const response = await request('POST', '/auth/login', { username, password }, '');
  assert.equal(response.statusCode, 200, response.body);
  return {
    cookie: response.cookies[0].name + '=' + response.cookies[0].value,
    user: response.json().user as Json,
  };
}
async function studentInBoth(name = '测试学员') {
  const student = await ok('POST', '/students', {
    name: `${name}${tag}`,
    phone: '13800000000',
    guardian_name: '监护人',
    guardian_relation: 'mother',
  });
  for (const cl of [class1, class2])
    await sql`INSERT INTO class_enrollments(class_id,student_id,joined_at) VALUES(${cl.id},${student.id},${past.starts_at}::timestamptz-interval '1 day')`.execute(
      db,
    );
  return student;
}
async function session(cl = class1, times = past) {
  return ok('POST', '/attendance-sessions', { class_id: cl.id, ...times });
}
async function record(
  s: Json,
  st: Json,
  status: 'present' | 'absent',
  version = 0,
  cookie = homeCookie,
) {
  return request(
    'PUT',
    `/attendance-sessions/${s.id}/records/${st.id}`,
    { status, expected_version: version },
    cookie,
  );
}
before(async () => {
  await migrate(db);
  app = await createApp(db, { logger: !!process.env.DEBUG_TESTS });
  const auth = await login('mkmAdmin', 'mkmAdmin');
  adminCookie = auth.cookie;
  adminId = auth.user.id;
  const time = await sql<{
    start: Date;
    end: Date;
  }>`SELECT date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' start,
    (date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') + (now()-(date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'))/2 AS end`.execute(
    db,
  );
  past = { starts_at: time.rows[0].start.toISOString(), ends_at: time.rows[0].end.toISOString() };
  campus1 = await ok('POST', '/campuses', { name: `东校区${tag}` });
  campus2 = await ok('POST', '/campuses', { name: `西校区${tag}` });
  course = await ok('POST', '/courses', { name: `美术${tag}` });
  class1 = await ok('POST', '/classes', {
    name: `启蒙班${tag}`,
    campus_id: campus1.id,
    course_id: course.id,
  });
  class2 = await ok('POST', '/classes', {
    name: `进阶班${tag}`,
    campus_id: campus2.id,
    course_id: course.id,
  });
  home = await ok('POST', '/users', {
    username: `hm_${tag}`,
    name: '班主任',
    phone: '13800000001',
    role: 'homeroom_teacher',
  });
  subject = await ok('POST', '/users', {
    username: `st_${tag}`,
    name: '任课老师',
    phone: '13800000002',
    role: 'subject_teacher',
  });
  outsider = await ok('POST', '/users', {
    username: `ot_${tag}`,
    name: '其他老师',
    phone: '13800000003',
    role: 'subject_teacher',
  });
  for (const cl of [class1, class2]) {
    await ok('PUT', `/classes/${cl.id}/teachers`, { role: 'homeroom_teacher', user_id: home.id });
    await ok('PUT', `/classes/${cl.id}/teachers`, { role: 'subject_teacher', user_id: subject.id });
  }
});
after(async () => {
  if (app) await app.close();
  await db.destroy();
});

test('管理员单例、身份与删除保护由数据库保证', async () => {
  const count = await sql<{
    count: number;
  }>`SELECT count(*)::int count FROM users WHERE role='admin'`.execute(db);
  assert.equal(count.rows[0].count, 1);
  await assert.rejects(sql`DELETE FROM users WHERE id=${adminId}`.execute(db), /ADMIN_PROTECTED/);
  await assert.rejects(
    sql`UPDATE users SET active=false WHERE id=${adminId}`.execute(db),
    /ADMIN_PROTECTED/,
  );
  await assert.rejects(
    sql`UPDATE users SET username='anotherAdmin' WHERE id=${adminId}`.execute(db),
    /ADMIN_PROTECTED/,
  );
  await assert.rejects(
    sql`UPDATE users SET role='subject_teacher' WHERE id=${adminId}`.execute(db),
    /ADMIN_PROTECTED/,
  );
  await assert.rejects(
    sql`INSERT INTO users(username,password_hash,name,role) VALUES('anotherAdmin','x','admin','admin')`.execute(
      db,
    ),
  );
});
test('教师首次登录只能改密；改密后旧会话失效', async () => {
  for (const [user, setCookie] of [
    [home, (v: string) => (homeCookie = v)],
    [subject, (v: string) => (subjectCookie = v)],
    [outsider, (v: string) => (outsiderCookie = v)],
  ] as const) {
    const auth = await login(user.username, 'Admin@123');
    assert.equal(auth.user.must_change_password, true);
    const blocked = await request('GET', '/lookups', undefined, auth.cookie);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error.code, 'PASSWORD_CHANGE_REQUIRED');
    await ok(
      'POST',
      '/auth/password',
      { currentPassword: 'Admin@123', newPassword: 'Teacher@123' },
      auth.cookie,
    );
    assert.equal((await request('GET', '/auth/me', undefined, auth.cookie)).statusCode, 401);
    setCookie((await login(user.username, 'Teacher@123')).cookie);
  }
});
test('权限与教师关联校验；非本班老师不能查询或写入', async () => {
  assert.equal((await request('POST', '/campuses', { name: '越权' }, homeCookie)).statusCode, 403);
  assert.equal((await request('GET', '/users', undefined, homeCookie)).statusCode, 403);
  assert.equal(
    (
      await request('PUT', `/classes/${class1.id}/teachers`, {
        role: 'homeroom_teacher',
        user_id: subject.id,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await request('GET', `/classes/${class1.id}`, undefined, outsiderCookie)).statusCode,
    404,
  );
  const s = await session();
  const st = await studentInBoth();
  assert.equal((await record(s, st, 'present', 0, outsiderCookie)).statusCode, 404);
  const empty = await ok('GET', '/reports/attendance', undefined, outsiderCookie);
  assert.equal(empty.total, 0);
  assert.equal((await ok('GET', '/audit-logs', undefined, outsiderCookie)).total, 0);
});
test('前端之外的接口同样拒绝课前处理，管理员没有提前录入例外', async () => {
  const now = Date.now();
  const s = await session(class1, {
    starts_at: new Date(now + 3600000).toISOString(),
    ends_at: new Date(now + 7200000).toISOString(),
  });
  const st = await studentInBoth();
  for (const cookie of [adminCookie, homeCookie, subjectCookie]) {
    const page = await request('GET', `/attendance-sessions/${s.id}/attendance`, undefined, cookie);
    assert.equal(page.statusCode, 409);
    assert.equal(page.json().error.code, 'SESSION_NOT_ENDED');
    const write = await record(s, st, 'present', 0, cookie);
    assert.equal(write.statusCode, 409);
  }
  assert.equal(
    (
      await request('POST', '/attendance-sessions', {
        class_id: class1.id,
        starts_at: past.ends_at,
        ends_at: past.starts_at,
      })
    ).statusCode,
    400,
  );
});
test('逐人保存、首次和修改审计、幂等提交与旧版本冲突', async () => {
  const s = await session();
  const st = await studentInBoth('审计学员');
  const first = await record(s, st, 'present');
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().version, 1);
  assert.equal(first.json().created_by, home.id);
  const same = await record(s, st, 'present', 1);
  assert.equal(same.statusCode, 200);
  assert.equal(same.json().version, 1);
  const changed = await record(s, st, 'absent', 1, subjectCookie);
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().version, 2);
  assert.equal(changed.json().updated_by, subject.id);
  const stale = await record(s, st, 'present', 1);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'ATTENDANCE_VERSION_CONFLICT');
  const logs = await ok('GET', `/audit-logs?student_id=${st.id}`, undefined, homeCookie);
  assert.equal(logs.total, 2);
  assert.equal(logs.items[0].old_status, 'present');
  assert.equal(logs.items[0].new_status, 'absent');
  assert.equal(logs.items[1].old_status, null);
  await assert.rejects(
    sql`UPDATE audit_logs SET actor_name='tampered' WHERE student_id=${st.id}`.execute(db),
    /AUDIT_IMMUTABLE/,
  );
  await assert.rejects(
    sql`DELETE FROM audit_logs WHERE student_id=${st.id}`.execute(db),
    /AUDIT_IMMUTABLE/,
  );
  await assert.rejects(
    sql`DELETE FROM attendance_records WHERE student_id=${st.id}`.execute(db),
    /ATTENDANCE_DELETE_FORBIDDEN/,
  );
});
test('跨班重叠出勤在并发请求下也最多一条成功，失败不留下审计', async () => {
  const st = await studentInBoth('并发学员');
  const s1 = await session(class1);
  const s2 = await session(class2);
  const responses = await Promise.all([
    record(s1, st, 'present', 0, homeCookie),
    record(s2, st, 'present', 0, subjectCookie),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    responses.find((r) => r.statusCode === 409)!.json().error.code,
    'ATTENDANCE_TIME_CONFLICT',
  );
  const logs = await ok('GET', `/audit-logs?student_id=${st.id}`);
  assert.equal(logs.total, 1);
  const loser = responses[0].statusCode === 409 ? s1 : s2;
  const absent = await record(loser, st, 'absent');
  assert.equal(absent.statusCode, 200, absent.body);
  const conflict = await record(loser, st, 'present', 1);
  assert.equal(conflict.statusCode, 409);
  assert.equal((await ok('GET', `/audit-logs?student_id=${st.id}`)).total, 2);
});
test('同一学员同一时段的并发初次录入不会互相覆盖', async () => {
  const st = await studentInBoth('同条并发');
  const s = await session();
  const writes = await Promise.all([
    record(s, st, 'present'),
    record(s, st, 'absent', 0, subjectCookie),
  ]);
  assert.deepEqual(writes.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    writes.find((r) => r.statusCode === 409)!.json().error.code,
    'ATTENDANCE_VERSION_CONFLICT',
  );
  assert.equal((await ok('GET', `/audit-logs?student_id=${st.id}`)).total, 1);
});
test('首尾相接时段允许同时出勤；同班重叠不属于跨班冲突', async () => {
  const st = await studentInBoth('相邻学员');
  const mid = new Date(
    (new Date(past.starts_at).getTime() + new Date(past.ends_at).getTime()) / 2,
  ).toISOString();
  const a = await session(class1, { starts_at: past.starts_at, ends_at: mid });
  const b = await session(class2, { starts_at: mid, ends_at: past.ends_at });
  assert.equal((await record(a, st, 'present')).statusCode, 200);
  assert.equal((await record(b, st, 'present')).statusCode, 200);
  const sameClass = await session(class1, { starts_at: past.starts_at, ends_at: mid });
  assert.equal((await record(sameClass, st, 'present')).statusCode, 200);
});
test('ends_at 等于数据库事务 now() 时允许录入', async () => {
  const st = await studentInBoth('时间边界');
  await db.transaction().execute(async (tx) => {
    await sql`SELECT set_config('agenda.actor_id',${adminId},true)`.execute(tx);
    const s = await sql<{
      id: string;
    }>`INSERT INTO attendance_sessions(class_id,starts_at,ends_at) VALUES(${class1.id},now()-interval '1 hour',now()) RETURNING id`.execute(
      tx,
    );
    const r = await sql<{
      status: string;
    }>`INSERT INTO attendance_records(session_id,student_id,status) VALUES(${s.rows[0].id},${st.id},'present') RETURNING status`.execute(
      tx,
    );
    assert.equal(r.rows[0].status, 'present');
  });
});
test('已有考勤锁定时段和班级归属；历史分班不能回写', async () => {
  const st = await studentInBoth('历史学员');
  const s = await session();
  assert.equal((await record(s, st, 'present')).statusCode, 200);
  const changed = await request('PATCH', `/attendance-sessions/${s.id}`, {
    class_id: class1.id,
    starts_at: past.starts_at,
    ends_at: new Date(new Date(past.ends_at).getTime() - 1000).toISOString(),
  });
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.json().error.code, 'SESSION_LOCKED');
  assert.equal((await request('DELETE', `/attendance-sessions/${s.id}`)).statusCode, 409);
  assert.equal(
    (
      await request('PATCH', `/classes/${class1.id}`, {
        name: class1.name,
        campus_id: campus2.id,
        course_id: course.id,
      })
    ).statusCode,
    409,
  );
  const before = await ok('GET', `/attendance-sessions/${s.id}/attendance`);
  const en = await db
    .selectFrom('class_enrollments')
    .selectAll()
    .where('student_id', '=', st.id)
    .where('class_id', '=', class1.id)
    .executeTakeFirstOrThrow();
  await ok('POST', `/classes/${class1.id}/enrollments/${en.id}/withdraw`);
  const after = await ok('GET', `/attendance-sessions/${s.id}/attendance`);
  assert.equal(after.students.length, before.students.length);
  assert.ok(after.students.some((r: Json) => r.student_id === st.id));
  await assert.rejects(
    sql`UPDATE class_enrollments SET joined_at=now() WHERE id=${en.id}`.execute(db),
    /ENROLLMENT_HISTORY_IMMUTABLE/,
  );
});
test('周预警跨校区解除；筛选只改变名单，不改变全局出勤判定', async () => {
  const st = await studentInBoth('周预警');
  assert.ok(
    (
      await ok('GET', `/weekly-warnings?campus_id=${campus2.id}&q=${encodeURIComponent(st.name)}`)
    ).items.some((r: Json) => r.id === st.id),
  );
  const s = await session(class1);
  assert.equal((await record(s, st, 'present')).statusCode, 200);
  assert.equal(
    (await ok('GET', `/weekly-warnings?campus_id=${campus2.id}&q=${encodeURIComponent(st.name)}`))
      .total,
    0,
  );
  assert.equal((await record(s, st, 'absent', 1)).statusCode, 200);
  assert.equal(
    (await ok('GET', `/weekly-warnings?campus_id=${campus2.id}&q=${encodeURIComponent(st.name)}`))
      .total,
    1,
  );
  const unassigned = await ok('POST', '/students', {
    name: `未分班${tag}`,
    phone: '13800000000',
    guardian_name: '家长',
    guardian_relation: 'father',
  });
  assert.equal(
    (await ok('GET', `/weekly-warnings?q=${encodeURIComponent(unassigned.name)}`)).total,
    1,
  );
  assert.equal(
    (
      await ok(
        'GET',
        `/weekly-warnings?q=${encodeURIComponent(unassigned.name)}`,
        undefined,
        homeCookie,
      )
    ).total,
    0,
  );
});
test('报表仅统计已结束时段，明确区分缺勤与未录入，导出遵守权限', async () => {
  const r = await ok('GET', `/reports/attendance?campus_id=${campus1.id}`);
  assert.equal(r.summary.expected, r.summary.present + r.summary.absent + r.summary.unrecorded);
  assert.ok(r.summary.unrecorded > 0);
  assert.ok(
    r.items.every(
      (row: Json) => row.campus_id === campus1.id && new Date(row.ends_at) <= new Date(),
    ),
  );
  const empty = await ok('GET', `/reports/attendance?from=2099-01-01&to=2099-12-31`);
  assert.equal(empty.summary.expected, 0);
  assert.equal(empty.summary.attendance_rate, null);
  const exported = await request('GET', `/reports/attendance.csv?campus_id=${campus1.id}`);
  assert.equal(exported.statusCode, 200);
  assert.ok(exported.body.includes('未录入'));
  assert.ok(exported.body.includes(campus1.name));
  assert.ok(!exported.body.includes(campus2.name));
  const unauthorized = await request('GET', '/reports/attendance.csv', undefined, outsiderCookie);
  assert.equal(unauthorized.body.trim().split('\r\n').length, 1);
  assert.match(csv(['name'], [['=1+1'], ['+86138'], ['a"b']]), /'=1\+1/);
  assert.ok(csv(['name'], [['a"b']]).includes('a""b'));
  assert.equal((await request('GET', '/reports/attendance?from=2026-02-30')).statusCode, 400);
});
test('移除班级关联立即撤销权限；禁用及重置密码撤销会话', async () => {
  await ok('PUT', `/classes/${class1.id}/teachers`, { role: 'subject_teacher', user_id: null });
  assert.equal(
    (await request('GET', `/classes/${class1.id}`, undefined, subjectCookie)).statusCode,
    404,
  );
  assert.equal(
    (await ok('GET', `/audit-logs?class_id=${class1.id}`, undefined, subjectCookie)).total,
    0,
  );
  await ok('PUT', `/classes/${class1.id}/teachers`, {
    role: 'subject_teacher',
    user_id: subject.id,
  });
  await ok('PATCH', `/users/${outsider.id}`, {
    name: outsider.name,
    phone: outsider.phone,
    active: false,
  });
  assert.equal((await request('GET', '/auth/me', undefined, outsiderCookie)).statusCode, 401);
  await ok('POST', `/users/${home.id}/reset-password`);
  assert.equal((await request('GET', '/auth/me', undefined, homeCookie)).statusCode, 401);
  assert.equal((await login(home.username, 'Admin@123')).user.must_change_password, true);
});
test('请求来源校验和身份字段注入保护', async () => {
  const csrf = await app.inject({
    method: 'POST',
    url: '/api/campuses',
    headers: { cookie: adminCookie, origin: 'https://evil.example' },
    payload: { name: '不应该创建' },
  });
  assert.equal(csrf.statusCode, 403);
  const injected = await request('POST', '/students', {
    name: '注入',
    phone: '13800000000',
    guardian_name: '家长',
    guardian_relation: 'relative',
    created_by: adminId,
  });
  assert.equal(injected.statusCode, 400);
  const unknown = await request(
    'POST',
    '/auth/login',
    { username: `missing_${tag}`, password: 'incorrect' },
    '',
  );
  assert.equal(unknown.statusCode, 401);
  const dashboard = await ok('GET', '/dashboard');
  assert.equal(dashboard.trend.length, 7);
  assert.ok(dashboard.classes >= 2);
});

test('非名单学员、伪造操作者和缺失操作者均不能生成考勤', async () => {
  const st = await ok('POST', '/students', {
    name: `未入班校验${tag}`,
    phone: '13800000000',
    guardian_name: '家长',
    guardian_relation: 'relative',
  });
  const s = await session();
  const invalid = await record(s, st, 'present', 0, adminCookie);
  assert.equal(invalid.statusCode, 409);
  assert.equal(invalid.json().error.code, 'STUDENT_NOT_ENROLLED');
  const forged = await request('PUT', `/attendance-sessions/${s.id}/records/${st.id}`, {
    status: 'present',
    expected_version: 0,
    created_by: adminId,
  });
  assert.equal(forged.statusCode, 400);
  await assert.rejects(
    sql`INSERT INTO attendance_records(session_id,student_id,status) VALUES(${s.id},${st.id},'present')`.execute(
      db,
    ),
    /UNAUTHENTICATED/,
  );
  assert.equal((await ok('GET', `/audit-logs?student_id=${st.id}`)).total, 0);
});

test('首次录入与修改时段并发时，记录区间始终与时段一致', async () => {
  const st = await studentInBoth('排课并发');
  const s = await session();
  const nextEnd = new Date(new Date(past.ends_at).getTime() - 1000).toISOString();
  const [write, edit] = await Promise.all([
    record(s, st, 'present', 0, adminCookie),
    request('PATCH', `/attendance-sessions/${s.id}`, {
      class_id: class1.id,
      starts_at: past.starts_at,
      ends_at: nextEnd,
    }),
  ]);
  assert.equal(write.statusCode, 200, write.body);
  assert.ok([200, 409].includes(edit.statusCode), edit.body);
  const match = await sql<{
    matches: boolean;
  }>`SELECT r.period=tstzrange(s.starts_at,s.ends_at,'[)') AS matches FROM attendance_records r JOIN attendance_sessions s ON s.id=r.session_id WHERE r.student_id=${st.id}`.execute(
    db,
  );
  assert.equal(match.rows[0].matches, true);
});

test('跨日跨周使用北京时间，补录上周出勤不能解除本周预警', async () => {
  const boundaryClass = await ok('POST', '/classes', {
    name: `时间边界班${tag}`,
    campus_id: campus1.id,
    course_id: course.id,
  });
  const st = await studentInBoth('跨周学员');
  await sql`INSERT INTO class_enrollments(class_id,student_id,joined_at) VALUES(${boundaryClass.id},${st.id},${past.starts_at}::timestamptz-interval '1 day')`.execute(
    db,
  );
  const midnight = new Date(past.starts_at).getTime();
  const sunday = await session(boundaryClass, {
    starts_at: new Date(midnight - 60000).toISOString(),
    ends_at: past.starts_at,
  });
  const monday = await session(boundaryClass, {
    starts_at: past.starts_at,
    ends_at: new Date(midnight + Math.min(60000, (Date.now() - midnight) / 2)).toISOString(),
  });
  assert.equal((await record(sunday, st, 'present', 0, adminCookie)).statusCode, 200);
  assert.equal((await ok('GET', `/weekly-warnings?q=${encodeURIComponent(st.name)}`)).total, 1);
  const localDay = (value: number) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(value));
  for (const [day, expectedSession] of [
    [localDay(midnight - 60000), sunday.id],
    [localDay(midnight), monday.id],
  ]) {
    const report = await ok(
      'GET',
      `/reports/attendance?class_id=${boundaryClass.id}&from=${day}&to=${day}`,
    );
    assert.equal(report.total, 1);
    assert.equal(report.items[0].session_id, expectedSession);
  }
  assert.equal((await record(monday, st, 'present', 0, adminCookie)).statusCode, 200);
  assert.equal((await ok('GET', `/weekly-warnings?q=${encodeURIComponent(st.name)}`)).total, 0);
});

test('管理员可以改密且旧会话失效；测试结束恢复测试库初始密码', async () => {
  const original = await db
    .selectFrom('users')
    .select('password_hash')
    .where('id', '=', adminId)
    .executeTakeFirstOrThrow();
  try {
    await ok('POST', '/auth/password', {
      currentPassword: 'mkmAdmin',
      newPassword: 'AdminChanged@123',
    });
    assert.equal((await request('GET', '/auth/me')).statusCode, 401);
    const fresh = await login('mkmAdmin', 'AdminChanged@123');
    assert.equal(fresh.user.role, 'admin');
  } finally {
    await db
      .updateTable('users')
      .set({ password_hash: original.password_hash })
      .where('id', '=', adminId)
      .execute();
    await db.deleteFrom('auth_sessions').where('user_id', '=', adminId).execute();
    adminCookie = (await login('mkmAdmin', 'mkmAdmin')).cookie;
  }
});
