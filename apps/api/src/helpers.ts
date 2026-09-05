import { sql, type RawBuilder, type Transaction } from 'kysely';
import type { FastifyRequest } from 'fastify';
import { id, type User, type ListQuery } from '@agenda/shared';
import type { Database, Db } from './db/index.js';
import { AppError, fail } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}
export type Tx = Transaction<Database>;
export type Executor = Db | Tx;
export type Row = Record<string, unknown>;
export function actor(req: FastifyRequest): User {
  if (!req.user) fail('UNAUTHENTICATED');
  return req.user;
}
export function admin(req: FastifyRequest) {
  const user = actor(req);
  if (user.role !== 'admin') fail('FORBIDDEN');
  return user;
}
export function param(req: FastifyRequest, key = 'id') {
  return id.parse((req.params as Record<string, string>)[key]);
}
export async function asActor<T>(db: Db, user: User, fn: (tx: Tx) => Promise<T>) {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT set_config('agenda.actor_id', ${user.id}, true)`.execute(tx);
    const current = await tx
      .selectFrom('users')
      .select(['id', 'active', 'must_change_password', 'role'])
      .where('id', '=', user.id)
      .forShare()
      .executeTakeFirst();
    if (!current?.active) fail('UNAUTHENTICATED');
    if (current.must_change_password) fail('PASSWORD_CHANGE_REQUIRED');
    return fn(tx);
  });
}
export function classScope(user: User, column = 'c.id') {
  return user.role === 'admin'
    ? sql`true`
    : sql`EXISTS (SELECT 1 FROM class_teachers access WHERE access.class_id = ${sql.ref(column)} AND access.user_id = ${user.id})`;
}
export async function requireClass(db: Executor, user: User, classId: string, lock = false) {
  const result = await sql<
    Row & { id: string; archived_at: Date | null }
  >`SELECT c.* FROM classes c WHERE c.id = ${classId} AND ${classScope(user)} ${lock ? sql`FOR UPDATE` : sql``}`.execute(
    db,
  );
  if (!result.rows[0]) fail('NOT_FOUND');
  return result.rows[0];
}
export function filters(q: ListQuery, user: User, dateColumn = 's.starts_at') {
  const parts: RawBuilder<unknown>[] = [classScope(user)];
  if (q.campus_id) parts.push(sql`c.campus_id = ${q.campus_id}`);
  if (q.course_id) parts.push(sql`c.course_id = ${q.course_id}`);
  if (q.class_id) parts.push(sql`c.id = ${q.class_id}`);
  if (q.from)
    parts.push(
      sql`${sql.ref(dateColumn)} >= (${q.from}::date::timestamp AT TIME ZONE 'Asia/Shanghai')`,
    );
  if (q.to)
    parts.push(
      sql`${sql.ref(dateColumn)} < ((${q.to}::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')`,
    );
  return parts;
}
export function and(parts: RawBuilder<unknown>[]) {
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`;
}
export async function paginate<T>(db: Executor, query: RawBuilder<unknown>, q: ListQuery) {
  const count = await sql<{
    total: number;
  }>`SELECT count(*)::int total FROM (${query}) counted`.execute(db);
  const result =
    await sql<T>`${query} LIMIT ${q.page_size} OFFSET ${(q.page - 1) * q.page_size}`.execute(db);
  return { items: result.rows, total: count.rows[0].total, page: q.page, page_size: q.page_size };
}
export function active(record: { archived_at?: unknown }) {
  if (record.archived_at) throw new AppError('ARCHIVED', '此记录已归档，不能继续新增或修改', 409);
}
export function csv(headers: string[], rows: unknown[][]) {
  const escape = (value: unknown) => {
    let text =
      value == null
        ? ''
        : value instanceof Date
          ? value.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
          : String(value);
    if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
}
