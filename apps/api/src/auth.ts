import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from 'argon2';
import { sql } from 'kysely';
import cookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { loginSchema, passwordSchema, type User } from '@agenda/shared';
import type { Db } from './db/index.js';
import { actor } from './helpers.js';
import { AppError, fail } from './errors.js';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export async function registerAuth(
  app: FastifyInstance,
  db: Db,
  origin: string,
  production: boolean,
) {
  await app.register(cookie);
  app.decorateRequest('user', null);
  // Equal-cost verification when a username does not exist.
  const dummyHash = await hash(randomBytes(32).toString('hex'));
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin !== new URL(origin).origin
    ) {
      throw new AppError('INVALID_ORIGIN', '请求来源校验失败，请从系统页面重新操作', 403);
    }
    const path = req.url.split('?')[0];
    if (path === '/api/auth/login' || path === '/api/health') return;
    const token = req.cookies.agenda_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) fail('UNAUTHENTICATED');
    const user = await db
      .selectFrom('auth_sessions as a')
      .innerJoin('users as u', 'u.id', 'a.user_id')
      .select([
        'u.id',
        'u.username',
        'u.name',
        'u.phone',
        'u.role',
        'u.must_change_password',
        'u.active',
      ])
      .where('a.token_hash', '=', digest(token))
      .where('a.expires_at', '>', sql<Date>`now()`)
      .where('u.active', '=', true)
      .executeTakeFirst();
    if (!user) fail('UNAUTHENTICATED');
    req.user = user as User;
    if (
      user.must_change_password &&
      !['/api/auth/me', '/api/auth/password', '/api/auth/logout'].includes(path)
    )
      fail('PASSWORD_CHANGE_REQUIRED');
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    for (const [key, limit] of [
      [`ip:${req.ip}`, 100],
      [`user:${body.username.toLowerCase()}`, 10],
    ] as const) {
      const attempts = await sql<{
        attempts: number;
      }>`INSERT INTO login_attempts(key,attempts) VALUES(${digest(key)},1)
        ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN login_attempts.window_start < now() - interval '15 minutes' THEN 1 ELSE login_attempts.attempts + 1 END,
          window_start = CASE WHEN login_attempts.window_start < now() - interval '15 minutes' THEN now() ELSE login_attempts.window_start END
        RETURNING attempts`.execute(db);
      if (attempts.rows[0].attempts > limit)
        throw new AppError('LOGIN_RATE_LIMITED', '尝试次数过多，请 15 分钟后再试', 429);
    }
    const token = randomBytes(32).toString('hex');
    const user = await db.transaction().execute(async (tx) => {
      const found = await tx
        .selectFrom('users')
        .selectAll()
        .where('username', '=', body.username)
        .forShare()
        .executeTakeFirst();
      const valid = await verify(found?.password_hash ?? dummyHash, body.password);
      if (!found || !valid || !found.active)
        throw new AppError('INVALID_CREDENTIALS', '用户名或密码错误，或账号已被禁用', 401);
      await tx
        .insertInto('auth_sessions')
        .values({
          token_hash: digest(token),
          user_id: found.id,
          expires_at: sql<Date>`now() + interval '12 hours'`,
        })
        .execute();
      await tx
        .deleteFrom('login_attempts')
        .where('key', '=', digest(`user:${body.username.toLowerCase()}`))
        .execute();
      const { password_hash: _, created_at: __, ...safe } = found;
      return safe;
    });
    await db
      .deleteFrom('auth_sessions')
      .where('expires_at', '<=', sql<Date>`now()`)
      .execute();
    await db
      .deleteFrom('login_attempts')
      .where('window_start', '<', sql<Date>`now() - interval '1 day'`)
      .execute();
    reply.setCookie('agenda_session', token, {
      httpOnly: true,
      secure: production,
      sameSite: 'lax',
      path: '/',
      maxAge: 43200,
    });
    return { user };
  });
  app.get('/api/auth/me', async (req) => ({ user: actor(req) }));
  app.post('/api/auth/logout', async (req, reply) => {
    await db
      .deleteFrom('auth_sessions')
      .where('token_hash', '=', digest(req.cookies.agenda_session!))
      .execute();
    reply.clearCookie('agenda_session', { path: '/' });
    return { ok: true };
  });
  app.post('/api/auth/password', async (req, reply) => {
    const body = passwordSchema.parse(req.body);
    if (body.newPassword === body.currentPassword)
      throw new AppError('PASSWORD_UNCHANGED', '新密码不能与原密码相同');
    await db.transaction().execute(async (tx) => {
      const user = await tx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', actor(req).id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (!user.active) fail('UNAUTHENTICATED');
      if (!(await verify(user.password_hash, body.currentPassword)))
        throw new AppError('INVALID_PASSWORD', '原密码不正确');
      await tx
        .updateTable('users')
        .set({ password_hash: await hash(body.newPassword), must_change_password: false })
        .where('id', '=', user.id)
        .execute();
      await tx.deleteFrom('auth_sessions').where('user_id', '=', user.id).execute();
    });
    reply.clearCookie('agenda_session', { path: '/' });
    return { ok: true, message: '密码已修改，请使用新密码重新登录' };
  });
}
