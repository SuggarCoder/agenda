import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const messages: Record<string, [number, string]> = {
  UNAUTHENTICATED: [401, '登录已失效，请重新登录'],
  FORBIDDEN: [403, '没有操作权限'],
  NOT_FOUND: [404, '记录不存在或无权访问'],
  PASSWORD_CHANGE_REQUIRED: [403, '请先修改初始密码'],
  SESSION_NOT_ENDED: [409, '本次上课尚未结束，暂不能处理考勤'],
  STUDENT_NOT_ENROLLED: [409, '该学员不在本次上课时的分班名单中'],
  SESSION_LOCKED: [409, '已有考勤记录，不能修改时间、班级或删除时段'],
  ADMIN_PROTECTED: [409, '管理员账号不能删除、禁用或更改身份'],
  ROLE_IMMUTABLE: [409, '账号角色不能修改，请创建对应角色的新账号'],
  CLASS_HISTORY_LOCKED: [409, '班级已有排课，不能更改所属校区或课程'],
  ENROLLMENT_HISTORY_IMMUTABLE: [409, '历史分班记录不能修改或删除'],
  AUDIT_IMMUTABLE: [403, '审计日志只允许查询'],
  ATTENDANCE_DELETE_FORBIDDEN: [403, '考勤记录不能删除，请更正出勤状态'],
  RECORD_IDENTITY_IMMUTABLE: [409, '考勤所属学员和时段不能修改'],
};
export function fail(code: string): never {
  const [status, message] = messages[code] ?? [400, '操作失败'];
  throw new AppError(code, message, status);
}
export function installErrors(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues.map((i) => i.message).join('；'),
          details: error.flatten(),
        },
      });
    if (error instanceof AppError)
      return reply
        .status(error.status)
        .send({ error: { code: error.code, message: error.message } });
    const err = error as {
      code?: string;
      message?: string;
      statusCode?: number;
      constraint?: string;
    };
    if (err.code === 'P0001' && err.message && messages[err.message]) {
      const [status, message] = messages[err.message];
      return reply.status(status).send({ error: { code: err.message, message } });
    }
    if (err.code === '23P01') {
      const attendance = err.constraint === 'present_cross_class_overlap';
      return reply.status(409).send({
        error: {
          code: attendance ? 'ATTENDANCE_TIME_CONFLICT' : 'ENROLLMENT_OVERLAP',
          message: attendance
            ? '该学员已在时间重叠的其他班级记为出勤，请核实后更正'
            : '该学员已在本班，不能重复分班',
        },
      });
    }
    if (err.code === '23505')
      return reply.status(409).send({
        error: { code: 'DUPLICATE', message: '记录已存在，请检查用户名、名称或重复提交' },
      });
    if (err.code === '23503')
      return reply.status(409).send({
        error: { code: 'REFERENCE_CONFLICT', message: '关联记录不存在，或仍被历史数据引用' },
      });
    if (err.code === '23514')
      return reply.status(400).send({
        error: { code: 'CONSTRAINT_VIOLATION', message: '数据不符合业务规则，请检查后重试' },
      });
    if (err.code === '40P01' || err.code === '40001')
      return reply.status(409).send({
        error: { code: 'CONCURRENT_CHANGE', message: '数据正在被其他人修改，请刷新后重试' },
      });
    if (err.statusCode && err.statusCode < 500)
      return reply
        .status(err.statusCode)
        .send({ error: { code: 'INVALID_REQUEST', message: '请求格式不正确' } });
    request.log.error({ err: error }, 'request failed');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时无法完成操作，请稍后重试' } });
  });
}
