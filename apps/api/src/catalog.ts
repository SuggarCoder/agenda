import type { FastifyInstance } from 'fastify';
import { hash } from 'argon2';
import { sql, type RawBuilder } from 'kysely';
import {
  namedSchema,
  studentSchema,
  classSchema,
  teacherSchema,
  teacherUpdateSchema,
  assignmentSchema,
  enrollmentSchema,
  listQuerySchema,
  type User,
} from '@agenda/shared';
import type { Db } from './db/index.js';
import {
  actor,
  admin,
  param,
  asActor,
  classScope,
  requireClass,
  paginate,
  and,
  active,
  type Row,
  type Executor,
} from './helpers.js';
import { AppError, fail } from './errors.js';

const publicUserFields = [
  'id',
  'username',
  'name',
  'phone',
  'role',
  'must_change_password',
  'active',
  'created_at',
] as const;
const definitions = {
  campuses: { schema: namedSchema, search: ['name'] },
  courses: { schema: namedSchema, search: ['name'] },
  students: { schema: studentSchema, search: ['name', 'phone', 'guardian_name'] },
  classes: { schema: classSchema, search: ['name'] },
} as const;
type Entity = keyof typeof definitions;
function entityScope(entity: Entity, user: User) {
  if (user.role === 'admin') return sql`true`;
  if (entity === 'classes') return classScope(user, 't.id');
  if (entity === 'students')
    return sql`EXISTS(SELECT 1 FROM class_enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=t.id AND ${classScope(user)})`;
  return sql`EXISTS(SELECT 1 FROM classes c WHERE ${sql.ref(entity === 'campuses' ? 'c.campus_id' : 'c.course_id')}=t.id AND ${classScope(user)})`;
}
async function validClassParents(tx: Executor, campusId: string, courseId: string) {
  const campus = await tx
    .selectFrom('campuses')
    .selectAll()
    .where('id', '=', campusId)
    .forShare()
    .executeTakeFirst();
  const course = await tx
    .selectFrom('courses')
    .selectAll()
    .where('id', '=', courseId)
    .forShare()
    .executeTakeFirst();
  if (!campus || !course) fail('NOT_FOUND');
  active(campus);
  active(course);
}
export function registerCatalog(app: FastifyInstance, db: Db) {
  app.get('/api/users', async (req) => {
    admin(req);
    const q = listQuerySchema.parse(req.query);
    const conditions: RawBuilder<unknown>[] = [sql`true`];
    if (q.q)
      conditions.push(
        sql`(name ILIKE ${`%${q.q}%`} OR username ILIKE ${`%${q.q}%`} OR phone ILIKE ${`%${q.q}%`})`,
      );
    return paginate(
      db,
      sql`SELECT ${sql.join(publicUserFields.map((f) => sql.ref(f)))} FROM users WHERE ${and(conditions)} ORDER BY created_at DESC, id`,
      q,
    );
  });
  app.post('/api/users', async (req, reply) => {
    const user = admin(req);
    const body = teacherSchema.parse(req.body);
    const passwordHash = await hash('Admin@123');
    const result = await asActor(db, user, (tx) =>
      tx
        .insertInto('users')
        .values({ ...body, password_hash: passwordHash, must_change_password: true })
        .returning(publicUserFields)
        .executeTakeFirstOrThrow(),
    );
    return reply.code(201).send(result);
  });

  for (const [entity, definition] of Object.entries(definitions) as [
    Entity,
    (typeof definitions)[Entity],
  ][]) {
    app.get(`/api/${entity}`, async (req) => {
      const user = actor(req);
      const q = listQuerySchema.parse(req.query);
      const conditions: RawBuilder<unknown>[] = [entityScope(entity, user)];
      if (q.include_archived !== 'true') conditions.push(sql`t.archived_at IS NULL`);
      if (q.q)
        conditions.push(
          sql`(${sql.join(
            definition.search.map((f) => sql`${sql.ref(`t.${f}`)} ILIKE ${`%${q.q}%`}`),
            sql` OR `,
          )})`,
        );
      if (entity === 'classes') {
        if (q.campus_id) conditions.push(sql`t.campus_id = ${q.campus_id}`);
        if (q.course_id) conditions.push(sql`t.course_id = ${q.course_id}`);
      }
      if (entity === 'students' && q.class_id)
        conditions.push(
          sql`EXISTS(SELECT 1 FROM class_enrollments e JOIN classes c ON c.id=e.class_id WHERE e.student_id=t.id AND e.class_id=${q.class_id} AND e.left_at IS NULL AND ${classScope(user)})`,
        );
      const extras =
        entity === 'classes'
          ? sql`, ca.name campus_name, co.name course_name,
        (SELECT count(*)::int FROM class_enrollments e WHERE e.class_id=t.id AND e.joined_at<=now() AND (e.left_at IS NULL OR e.left_at>now())) student_count,
        (SELECT u.name FROM class_teachers ct JOIN users u ON u.id=ct.user_id WHERE ct.class_id=t.id AND ct.role='homeroom_teacher') homeroom_name,
        (SELECT u.name FROM class_teachers ct JOIN users u ON u.id=ct.user_id WHERE ct.class_id=t.id AND ct.role='subject_teacher') subject_name`
          : sql``;
      const joins =
        entity === 'classes'
          ? sql`JOIN campuses ca ON ca.id=t.campus_id JOIN courses co ON co.id=t.course_id`
          : sql``;
      return paginate(
        db,
        sql`SELECT t.* ${extras} FROM ${sql.table(entity)} t ${joins} WHERE ${and(conditions)} ORDER BY t.created_at DESC, t.id`,
        q,
      );
    });
    app.post(`/api/${entity}`, async (req, reply) => {
      const user = admin(req);
      const body = definition.schema.parse(req.body);
      const result = await asActor(db, user, async (tx) => {
        if (entity === 'classes') {
          const cl = classSchema.parse(body);
          await validClassParents(tx, cl.campus_id, cl.course_id);
        }
        const entries = Object.entries(body);
        const inserted =
          await sql<Row>`INSERT INTO ${sql.table(entity)} (${sql.join(entries.map(([k]) => sql.ref(k)))}) VALUES (${sql.join(entries.map(([, v]) => sql`${v}`))}) RETURNING *`.execute(
            tx,
          );
        return inserted.rows[0];
      });
      return reply.code(201).send(result);
    });
    app.patch(`/api/${entity}/:id`, async (req) => {
      const user = admin(req);
      const itemId = param(req);
      const body = definition.schema.parse(req.body);
      return asActor(db, user, async (tx) => {
        const existing =
          await sql<Row>`SELECT * FROM ${sql.table(entity)} WHERE id=${itemId} FOR UPDATE`.execute(
            tx,
          );
        if (!existing.rows[0]) fail('NOT_FOUND');
        active(existing.rows[0]);
        if (entity === 'classes') {
          const cl = classSchema.parse(body);
          await validClassParents(tx, cl.campus_id, cl.course_id);
        }
        const result =
          await sql<Row>`UPDATE ${sql.table(entity)} SET ${sql.join(Object.entries(body).map(([k, v]) => sql`${sql.ref(k)}=${v}`))} WHERE id=${itemId} RETURNING *`.execute(
            tx,
          );
        return result.rows[0];
      });
    });
    app.post(`/api/${entity}/:id/archive`, async (req) => {
      const user = admin(req);
      const itemId = param(req);
      return asActor(db, user, async (tx) => {
        const found =
          await sql<Row>`SELECT * FROM ${sql.table(entity)} WHERE id=${itemId} FOR UPDATE`.execute(
            tx,
          );
        if (!found.rows[0]) fail('NOT_FOUND');
        if (found.rows[0].archived_at) return { ok: true };
        if (entity === 'campuses' || entity === 'courses') {
          const children =
            await sql`SELECT id FROM classes WHERE ${sql.ref(entity === 'campuses' ? 'campus_id' : 'course_id')}=${itemId} AND archived_at IS NULL LIMIT 1`.execute(
              tx,
            );
          if (children.rows.length)
            throw new AppError('ACTIVE_CLASSES', '请先归档该校区或课程下的班级', 409);
        }
        if (entity === 'classes') {
          const future = await tx
            .selectFrom('attendance_sessions')
            .select('id')
            .where('class_id', '=', itemId)
            .where('ends_at', '>', sql<Date>`now()`)
            .limit(1)
            .execute();
          if (future.length)
            throw new AppError('UPCOMING_SESSIONS', '班级还有未结束的时段，请先调整排课', 409);
        }
        if (entity === 'students' || entity === 'classes') {
          await sql`UPDATE class_enrollments SET left_at=now() WHERE ${sql.ref(entity === 'students' ? 'student_id' : 'class_id')}=${itemId} AND left_at IS NULL`.execute(
            tx,
          );
        }
        await sql`UPDATE ${sql.table(entity)} SET archived_at=now() WHERE id=${itemId}`.execute(tx);
        return { ok: true };
      });
    });
  }
  app.patch('/api/users/:id', async (req) => {
    const user = admin(req);
    const userId = param(req);
    const body = teacherUpdateSchema.parse(req.body);
    return asActor(db, user, async (tx) => {
      const existing = await tx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) fail('NOT_FOUND');
      if (existing.role === 'admin') fail('ADMIN_PROTECTED');
      const updated = await tx
        .updateTable('users')
        .set(body)
        .where('id', '=', userId)
        .returning(publicUserFields)
        .executeTakeFirstOrThrow();
      if (!body.active)
        await tx.deleteFrom('auth_sessions').where('user_id', '=', userId).execute();
      return updated;
    });
  });
  app.post('/api/users/:id/reset-password', async (req) => {
    const user = admin(req);
    const userId = param(req);
    const password = await hash('Admin@123');
    return asActor(db, user, async (tx) => {
      const existing = await tx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!existing) fail('NOT_FOUND');
      if (existing.role === 'admin') fail('ADMIN_PROTECTED');
      await tx
        .updateTable('users')
        .set({ password_hash: password, must_change_password: true })
        .where('id', '=', userId)
        .execute();
      await tx.deleteFrom('auth_sessions').where('user_id', '=', userId).execute();
      return { ok: true };
    });
  });
  app.get('/api/classes/:id', async (req) => {
    const user = actor(req);
    const classId = param(req);
    const cl = await requireClass(db, user, classId);
    const teachers = await db
      .selectFrom('class_teachers as ct')
      .innerJoin('users as u', 'u.id', 'ct.user_id')
      .select(['u.id', 'u.name', 'u.active', 'ct.role'])
      .where('ct.class_id', '=', classId)
      .execute();
    const students =
      await sql`SELECT e.id enrollment_id, e.joined_at, e.left_at, st.* FROM class_enrollments e JOIN students st ON st.id=e.student_id WHERE e.class_id=${classId} ORDER BY (e.left_at IS NULL) DESC, st.name, e.joined_at DESC`.execute(
        db,
      );
    return { ...cl, teachers, students: students.rows };
  });
  app.put('/api/classes/:id/teachers', async (req) => {
    const user = admin(req);
    const classId = param(req);
    const body = assignmentSchema.parse(req.body);
    return asActor(db, user, async (tx) => {
      await requireClass(tx, user, classId, true);
      if (body.user_id) {
        const teacher = await tx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', body.user_id)
          .forShare()
          .executeTakeFirst();
        if (!teacher?.active || teacher.role !== body.role)
          throw new AppError('INVALID_TEACHER', '请选择对应角色的有效教师');
        await tx
          .insertInto('class_teachers')
          .values({ class_id: classId, ...body, user_id: body.user_id })
          .onConflict((oc) =>
            oc.columns(['class_id', 'role']).doUpdateSet({ user_id: body.user_id! }),
          )
          .execute();
      } else
        await tx
          .deleteFrom('class_teachers')
          .where('class_id', '=', classId)
          .where('role', '=', body.role)
          .execute();
      return { ok: true };
    });
  });
  app.post('/api/classes/:id/enrollments', async (req, reply) => {
    const user = admin(req);
    const classId = param(req);
    const body = enrollmentSchema.parse(req.body);
    const result = await asActor(db, user, async (tx) => {
      active(await requireClass(tx, user, classId, true));
      const student = await tx
        .selectFrom('students')
        .selectAll()
        .where('id', '=', body.student_id)
        .forUpdate()
        .executeTakeFirst();
      if (!student) fail('NOT_FOUND');
      active(student);
      return tx
        .insertInto('class_enrollments')
        .values({ class_id: classId, student_id: body.student_id, left_at: null })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return reply.code(201).send(result);
  });
  app.post('/api/classes/:id/enrollments/:enrollmentId/withdraw', async (req) => {
    const user = admin(req);
    const classId = param(req);
    const enrollmentId = param(req, 'enrollmentId');
    return asActor(db, user, async (tx) => {
      await requireClass(tx, user, classId, true);
      const record = await tx
        .selectFrom('class_enrollments')
        .selectAll()
        .where('id', '=', enrollmentId)
        .where('class_id', '=', classId)
        .executeTakeFirst();
      if (!record) fail('NOT_FOUND');
      if (!record.left_at)
        await tx
          .updateTable('class_enrollments')
          .set({ left_at: sql<Date>`now()` })
          .where('id', '=', enrollmentId)
          .execute();
      return { ok: true };
    });
  });
  app.get('/api/lookups', async (req) => {
    const user = actor(req);
    const result: Record<string, Row[]> = {};
    for (const entity of ['campuses', 'courses', 'classes', 'students'] as Entity[]) {
      const rows =
        await sql<Row>`SELECT t.id, t.name, t.archived_at ${entity === 'classes' ? sql`, t.campus_id, t.course_id` : sql``}
        FROM ${sql.table(entity)} t WHERE ${entityScope(entity, user)} ORDER BY t.name, t.id`.execute(
          db,
        );
      result[entity] = rows.rows;
    }
    result.teachers =
      user.role === 'admin'
        ? await db
            .selectFrom('users')
            .select(['id', 'name', 'role', 'active'])
            .where('role', '!=', 'admin')
            .orderBy('name')
            .execute()
        : [];
    return result;
  });
}
