import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import {
  sessionSchema,
  attendanceSchema,
  listQuerySchema,
  type User,
  type ListQuery,
} from '@agenda/shared';
import type { Db } from './db/index.js';
import {
  actor,
  admin,
  param,
  asActor,
  requireClass,
  filters,
  and,
  paginate,
  active,
  classScope,
  type Executor,
  type Row,
} from './helpers.js';
import { AppError, fail } from './errors.js';

export function sessionsQuery(user: User, q: ListQuery) {
  const conditions = filters(q, user);
  if (q.q) conditions.push(sql`c.name ILIKE ${`%${q.q}%`}`);
  return sql`SELECT list.* FROM (
    SELECT s.*, c.name class_name, ca.name campus_name, co.name course_name, ca.id campus_id, co.id course_id,
      totals.expected, totals.recorded, totals.present, totals.absent, totals.expected-totals.recorded unrecorded,
      now() server_now, s.ends_at<=now() can_process,
      CASE WHEN s.ends_at>now() THEN 'upcoming' WHEN totals.expected=totals.recorded THEN 'complete' WHEN totals.recorded=0 THEN 'pending' ELSE 'partial' END state
    FROM attendance_sessions s JOIN classes c ON c.id=s.class_id JOIN campuses ca ON ca.id=c.campus_id JOIN courses co ON co.id=c.course_id
    CROSS JOIN LATERAL (
      SELECT count(*)::int expected, count(r.id)::int recorded,
        (count(*) FILTER(WHERE r.status='present'))::int present, (count(*) FILTER(WHERE r.status='absent'))::int absent
      FROM class_enrollments e LEFT JOIN attendance_records r ON r.session_id=s.id AND r.student_id=e.student_id
      WHERE e.class_id=s.class_id AND e.joined_at<=s.starts_at AND (e.left_at IS NULL OR e.left_at>s.starts_at)
    ) totals
    WHERE ${and(conditions)}
  ) list WHERE ${q.state === 'todo' ? sql`list.state IN ('pending','partial')` : q.state ? sql`list.state=${q.state}` : sql`true`} ORDER BY list.starts_at DESC, list.id`;
}
async function processingSession(db: Executor, user: User, sessionId: string, lock = false) {
  const result = await sql<
    Row & { id: string; class_id: string; starts_at: Date; ends_at: Date; can_process: boolean }
  >`
    SELECT s.*, c.name class_name, ca.name campus_name, co.name course_name, s.ends_at<=now() can_process, now() server_now
    FROM attendance_sessions s JOIN classes c ON c.id=s.class_id JOIN campuses ca ON ca.id=c.campus_id JOIN courses co ON co.id=c.course_id
    WHERE s.id=${sessionId} AND ${classScope(user)} ${lock ? sql`FOR UPDATE OF s` : sql``}`.execute(
    db,
  );
  const session = result.rows[0];
  if (!session) fail('NOT_FOUND');
  if (!session.can_process) fail('SESSION_NOT_ENDED');
  return session;
}
export function registerAttendance(app: FastifyInstance, db: Db) {
  app.get('/api/attendance-sessions', async (req) => {
    const q = listQuerySchema.parse(req.query);
    return paginate(db, sessionsQuery(actor(req), q), q);
  });
  app.post('/api/attendance-sessions', async (req, reply) => {
    const user = admin(req);
    const body = sessionSchema.parse(req.body);
    const result = await asActor(db, user, async (tx) => {
      active(await requireClass(tx, user, body.class_id, true));
      return tx
        .insertInto('attendance_sessions')
        .values(body)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return reply.code(201).send(result);
  });
  app.patch('/api/attendance-sessions/:id', async (req) => {
    const user = admin(req);
    const sessionId = param(req);
    const body = sessionSchema.parse(req.body);
    return asActor(db, user, async (tx) => {
      const old = await tx
        .selectFrom('attendance_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .forUpdate()
        .executeTakeFirst();
      if (!old) fail('NOT_FOUND');
      active(await requireClass(tx, user, body.class_id, true));
      return tx
        .updateTable('attendance_sessions')
        .set(body)
        .where('id', '=', sessionId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  });
  app.delete('/api/attendance-sessions/:id', async (req) => {
    const user = admin(req);
    const sessionId = param(req);
    return asActor(db, user, async (tx) => {
      const result = await tx
        .deleteFrom('attendance_sessions')
        .where('id', '=', sessionId)
        .returning('id')
        .executeTakeFirst();
      if (!result) fail('NOT_FOUND');
      return { ok: true };
    });
  });
  app.get('/api/attendance-sessions/:id/attendance', async (req) => {
    const user = actor(req);
    const session = await processingSession(db, user, param(req));
    const roster =
      await sql`SELECT st.id student_id, st.name, st.phone, st.guardian_name, st.guardian_relation,
      r.id record_id, r.status, coalesce(r.version,0) version, r.created_at, r.updated_at,
      creator.name created_by_name, updater.name updated_by_name
      FROM class_enrollments e JOIN students st ON st.id=e.student_id
      LEFT JOIN attendance_records r ON r.student_id=st.id AND r.session_id=${session.id}
      LEFT JOIN users creator ON creator.id=r.created_by LEFT JOIN users updater ON updater.id=r.updated_by
      WHERE e.class_id=${session.class_id} AND e.joined_at<=${session.starts_at} AND (e.left_at IS NULL OR e.left_at>${session.starts_at})
      ORDER BY st.name, st.id`.execute(db);
    return { session, students: roster.rows };
  });
  app.put('/api/attendance-sessions/:id/records/:studentId', async (req) => {
    const user = actor(req);
    const sessionId = param(req);
    const studentId = param(req, 'studentId');
    const body = attendanceSchema.parse(req.body);
    return asActor(db, user, async (tx) => {
      await processingSession(tx, user, sessionId, true);
      const previous = await tx
        .selectFrom('attendance_records')
        .selectAll()
        .where('session_id', '=', sessionId)
        .where('student_id', '=', studentId)
        .executeTakeFirst();
      if ((previous?.version ?? 0) !== body.expected_version)
        throw new AppError(
          'ATTENDANCE_VERSION_CONFLICT',
          '考勤已被其他人修改，请刷新名单后重新操作',
          409,
        );
      if (previous?.status === body.status) return previous;
      const result = previous
        ? await sql<Row>`UPDATE attendance_records SET status=${body.status} WHERE id=${previous.id} RETURNING *`.execute(
            tx,
          )
        : await sql<Row>`INSERT INTO attendance_records(session_id,student_id,status) VALUES(${sessionId},${studentId},${body.status}) RETURNING *`.execute(
            tx,
          );
      return result.rows[0];
    });
  });
}
