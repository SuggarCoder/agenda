import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import {
  listQuerySchema,
  reportQuerySchema,
  roleLabels,
  type ListQuery,
  type ReportQuery,
  type User,
} from '@agenda/shared';
import type { Db } from './db/index.js';
import { actor, filters, and, classScope, paginate, csv, type Row } from './helpers.js';
import { sessionsQuery } from './attendance.js';

const weekStart = sql`(date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')`;
function teacherFilters(q: ReportQuery) {
  const where = [];
  if (q.teacher_id) where.push(sql`ct.user_id=${q.teacher_id}`);
  if (q.teacher_role) where.push(sql`ct.role=${q.teacher_role}`);
  return and(where);
}
function expectedQuery(user: User, q: ReportQuery) {
  const where = filters(q, user);
  if (q.teacher_id || q.teacher_role)
    where.push(
      sql`EXISTS(SELECT 1 FROM class_teachers ct WHERE ct.class_id=c.id AND ${teacherFilters(q)})`,
    );
  where.push(sql`s.ends_at<=now()`);
  if (q.student_id) where.push(sql`st.id=${q.student_id}`);
  if (q.q) where.push(sql`(st.name ILIKE ${`%${q.q}%`} OR c.name ILIKE ${`%${q.q}%`})`);
  return sql`SELECT s.id session_id, s.starts_at, s.ends_at, c.id class_id, c.name class_name, ca.id campus_id, ca.name campus_name,
    co.id course_id, co.name course_name, st.id student_id, st.name student_name, st.phone,
    (SELECT u.name FROM class_teachers ct JOIN users u ON u.id=ct.user_id WHERE ct.class_id=c.id AND ct.role='homeroom_teacher') homeroom_name,
    (SELECT u.name FROM class_teachers ct JOIN users u ON u.id=ct.user_id WHERE ct.class_id=c.id AND ct.role='subject_teacher') subject_name,
    r.status, r.version, r.updated_at, u.name updated_by_name
    FROM attendance_sessions s JOIN classes c ON c.id=s.class_id JOIN campuses ca ON ca.id=c.campus_id JOIN courses co ON co.id=c.course_id
    JOIN class_enrollments e ON e.class_id=s.class_id AND e.joined_at<=s.starts_at AND (e.left_at IS NULL OR e.left_at>s.starts_at)
    JOIN students st ON st.id=e.student_id LEFT JOIN attendance_records r ON r.session_id=s.id AND r.student_id=st.id
    LEFT JOIN users u ON u.id=r.updated_by WHERE ${and(where)}`;
}
const measures = sql`count(*)::int expected, (count(*) FILTER(WHERE status='present'))::int present,
  (count(*) FILTER(WHERE status='absent'))::int absent, (count(*) FILTER(WHERE status IS NULL))::int unrecorded,
  count(DISTINCT student_id)::int students, count(DISTINCT session_id)::int sessions,
  CASE WHEN count(*)=0 THEN NULL ELSE round(100.0 * count(*) FILTER(WHERE status='present') / count(*), 1)::float8 END attendance_rate,
  CASE WHEN count(*)=0 THEN NULL ELSE round(100.0 * count(status) / count(*), 1)::float8 END recording_rate`;
function teacherGroupsQuery(user: User, q: ReportQuery) {
  return sql<Row>`WITH expected AS (${expectedQuery(user, q)})
    SELECT ct.user_id teacher_id, u.name teacher_name, ct.role teacher_role,
      count(DISTINCT class_id)::int classes, ${measures}
    FROM expected e JOIN class_teachers ct USING(class_id) JOIN users u ON u.id=ct.user_id
    WHERE ${teacherFilters(q)}
    GROUP BY ct.user_id,u.name,ct.role ORDER BY ct.role,u.name,ct.user_id`;
}
export function warningsQuery(user: User, q: ListQuery) {
  const visible = [
    classScope(user),
    sql`e.joined_at<=now() AND (e.left_at IS NULL OR e.left_at>now())`,
  ];
  if (q.class_id) visible.push(sql`c.id=${q.class_id}`);
  if (q.campus_id) visible.push(sql`c.campus_id=${q.campus_id}`);
  if (q.course_id) visible.push(sql`c.course_id=${q.course_id}`);
  const mustHaveClass = user.role !== 'admin' || !!q.class_id || !!q.campus_id || !!q.course_id;
  return sql`SELECT st.id, st.name, st.phone, st.guardian_name, st.guardian_relation, membership.class_names, membership.campus_names
    FROM students st
    LEFT JOIN LATERAL (SELECT string_agg(DISTINCT c.name, '、' ORDER BY c.name) class_names,
      string_agg(DISTINCT ca.name, '、' ORDER BY ca.name) campus_names, count(*) count
      FROM class_enrollments e JOIN classes c ON c.id=e.class_id JOIN campuses ca ON ca.id=c.campus_id
      WHERE e.student_id=st.id AND ${and(visible)}) membership ON true
    WHERE st.archived_at IS NULL AND ${mustHaveClass ? sql`membership.count>0` : sql`true`}
      AND ${q.q ? sql`(st.name ILIKE ${`%${q.q}%`} OR st.phone ILIKE ${`%${q.q}%`})` : sql`true`}
      AND NOT EXISTS(SELECT 1 FROM attendance_records r JOIN attendance_sessions s ON s.id=r.session_id
        WHERE r.student_id=st.id AND r.status='present' AND s.starts_at>=${weekStart} AND s.starts_at<${weekStart}+interval '7 days')
    ORDER BY st.name, st.id`;
}
export function registerReports(app: FastifyInstance, db: Db) {
  app.get('/api/reports/attendance', async (req) => {
    const q = reportQuerySchema.parse(req.query);
    const expected = expectedQuery(actor(req), q);
    const summary =
      await sql<Row>`WITH expected AS (${expected}) SELECT ${measures} FROM expected`.execute(db);
    const groups =
      await sql<Row>`WITH expected AS (${expected}) SELECT campus_id, campus_name, course_id, course_name, class_id, class_name, ${measures}
      FROM expected GROUP BY campus_id,campus_name,course_id,course_name,class_id,class_name ORDER BY campus_name,course_name,class_name`.execute(
        db,
      );
    const details = await paginate(
      db,
      sql`${expected} ORDER BY s.starts_at DESC, c.name, st.name, s.id, st.id`,
      q,
    );
    const teachers = await teacherGroupsQuery(actor(req), q).execute(db);
    return { summary: summary.rows[0], groups: groups.rows, teachers: teachers.rows, ...details };
  });
  app.get('/api/reports/attendance/teachers.csv', async (req, reply) => {
    const q = reportQuerySchema.parse(req.query);
    const result = await teacherGroupsQuery(actor(req), q).execute(db);
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="attendance-teachers.csv"');
    return csv(
      [
        '教师',
        '角色',
        '班级数',
        '学员数（去重）',
        '时段数',
        '应到人次',
        '实到人次',
        '缺勤人次',
        '未录入人次',
        '出勤率',
        '录入完成率',
        '归属口径',
      ],
      result.rows.map((r) => [
        r.teacher_name,
        roleLabels[r.teacher_role as 'homeroom_teacher' | 'subject_teacher'],
        r.classes,
        r.students,
        r.sessions,
        r.expected,
        r.present,
        r.absent,
        r.unrecorded,
        r.attendance_rate === null ? '' : `${r.attendance_rate}%`,
        r.recording_rate === null ? '' : `${r.recording_rate}%`,
        '按当前班级教师分配，仅统计可见班级的已结束时段',
      ]),
    );
  });
  app.get('/api/reports/attendance.csv', async (req, reply) => {
    const q = reportQuerySchema.parse(req.query);
    const result =
      await sql<Row>`${expectedQuery(actor(req), q)} ORDER BY s.starts_at DESC, c.name, st.name, s.id, st.id`.execute(
        db,
      );
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="attendance.csv"');
    return csv(
      [
        '校区',
        '课程',
        '班级',
        '班主任（当前归属）',
        '任课老师（当前归属）',
        '开始时间（北京时间）',
        '结束时间（北京时间）',
        '学员',
        '电话',
        '考勤状态',
        '最后修改人',
        '最后修改时间',
      ],
      result.rows.map((r) => [
        r.campus_name,
        r.course_name,
        r.class_name,
        r.homeroom_name,
        r.subject_name,
        r.starts_at,
        r.ends_at,
        r.student_name,
        r.phone,
        r.status === 'present' ? '出勤' : r.status === 'absent' ? '缺勤' : '未录入',
        r.updated_by_name,
        r.updated_at,
      ]),
    );
  });
  app.get('/api/weekly-warnings', async (req) => {
    const q = listQuerySchema.parse(req.query);
    const timing =
      await sql`SELECT ${weekStart} week_start, ${weekStart}+interval '7 days' week_end, now() server_now`.execute(
        db,
      );
    return { ...timing.rows[0]!, ...(await paginate(db, warningsQuery(actor(req), q), q)) };
  });
  app.get('/api/weekly-warnings.csv', async (req, reply) => {
    const result =
      await sql<Row>`${warningsQuery(actor(req), listQuerySchema.parse(req.query))}`.execute(db);
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="weekly-warnings.csv"');
    return csv(
      ['学员', '电话', '监护人', '关系', '校区', '班级'],
      result.rows.map((r) => [
        r.name,
        r.phone,
        r.guardian_name,
        r.guardian_relation === 'father' ? '父' : r.guardian_relation === 'mother' ? '母' : '亲属',
        r.campus_names ?? '未分班',
        r.class_names ?? '未分班',
      ]),
    );
  });
  app.get('/api/audit-logs', async (req) => {
    const user = actor(req);
    const q = listQuerySchema.parse(req.query);
    const where = filters(q, user, 'a.occurred_at');
    if (q.student_id) where.push(sql`a.student_id=${q.student_id}`);
    if (q.actor_id) where.push(sql`a.actor_id=${q.actor_id}`);
    if (q.q)
      where.push(
        sql`(a.student_name ILIKE ${`%${q.q}%`} OR a.actor_name ILIKE ${`%${q.q}%`} OR c.name ILIKE ${`%${q.q}%`})`,
      );
    return paginate(
      db,
      sql`SELECT a.*, c.name class_name, ca.name campus_name, s.starts_at, s.ends_at FROM audit_logs a
      JOIN classes c ON c.id=a.class_id JOIN campuses ca ON ca.id=c.campus_id JOIN attendance_sessions s ON s.id=a.session_id
      WHERE ${and(where)} ORDER BY a.occurred_at DESC, a.version DESC, a.id`,
      q,
    );
  });
  app.get('/api/dashboard', async (req) => {
    const user = actor(req);
    const q = listQuerySchema.parse({ page_size: 6 });
    const counts = await sql`SELECT
      (SELECT count(*)::int FROM classes c WHERE c.archived_at IS NULL AND ${classScope(user)}) classes,
      (SELECT count(*)::int FROM students st WHERE st.archived_at IS NULL AND ${user.role === 'admin' ? sql`true` : sql`EXISTS(SELECT 1 FROM class_enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=st.id AND e.joined_at<=now() AND (e.left_at IS NULL OR e.left_at>now()) AND ${classScope(user)})`}) students,
      (SELECT count(*)::int FROM (${warningsQuery(user, q)}) warnings) warnings,
      (SELECT count(*)::int FROM (${sessionsQuery(user, q)}) sessions WHERE state IN ('pending','partial')) pending,
      now() server_now, ${weekStart} week_start`.execute(db);
    const todo =
      await sql`SELECT * FROM (${sessionsQuery(user, q)}) s WHERE state IN ('pending','partial') ORDER BY ends_at DESC,id LIMIT 6`.execute(
        db,
      );
    const recent =
      await sql`SELECT a.id,a.actor_name,a.student_name,a.action,a.new_status,a.occurred_at,c.name class_name FROM audit_logs a JOIN classes c ON c.id=a.class_id
      WHERE ${classScope(user)} ORDER BY a.occurred_at DESC,a.id LIMIT 5`.execute(db);
    const trend = await sql`WITH expected AS (${expectedQuery(user, q)}), days AS (
      SELECT generate_series((now() AT TIME ZONE 'Asia/Shanghai')::date-6,(now() AT TIME ZONE 'Asia/Shanghai')::date,interval '1 day')::date AS day
    ) SELECT to_char(d.day,'YYYY-MM-DD') AS day, count(e.student_id)::int expected,
      (count(e.student_id) FILTER(WHERE e.status='present'))::int present,
      (count(e.student_id) FILTER(WHERE e.status='absent'))::int absent,
      (count(e.student_id) FILTER(WHERE e.status IS NULL))::int unrecorded
      FROM days d LEFT JOIN expected e ON (e.starts_at AT TIME ZONE 'Asia/Shanghai')::date=d.day GROUP BY d.day ORDER BY d.day`.execute(
      db,
    );
    return { ...counts.rows[0]!, todo: todo.rows, recent: recent.rows, trend: trend.rows };
  });
}
