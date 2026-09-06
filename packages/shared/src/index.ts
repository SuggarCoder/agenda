import { z } from 'zod';

export const roles = ['admin', 'homeroom_teacher', 'subject_teacher'] as const;
export type Role = (typeof roles)[number];
export const roleLabels: Record<Role, string> = {
  admin: '管理员',
  homeroom_teacher: '班主任',
  subject_teacher: '任课老师',
};
export const statusLabels = { present: '出勤', absent: '缺勤', unrecorded: '未录入' } as const;
export const guardianLabels = { father: '父', mother: '母', relative: '亲属' } as const;
export const teacherRole = z.enum(['homeroom_teacher', 'subject_teacher']);
export const id = z.string().uuid();
const name = z.string().trim().min(1, '不能为空').max(80, '最多 80 个字');
const phone = z
  .string()
  .trim()
  .min(6, '请输入有效电话号码')
  .max(25)
  .regex(/^[+\d\s()-]+$/, '电话号码格式不正确');
export const loginSchema = z
  .object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(128) })
  .strict();
export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8, '新密码至少 8 位').max(128),
  })
  .strict();
export const teacherSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-zA-Z0-9_]+$/, '用户名仅支持字母、数字和下划线')
      .refine((v) => v !== 'mkmAdmin', '此用户名已保留'),
    name,
    phone,
    role: teacherRole,
  })
  .strict();
export const teacherUpdateSchema = z.object({ name, phone, active: z.boolean() }).strict();
export const namedSchema = z.object({ name }).strict();
export const studentSchema = z
  .object({
    name,
    phone,
    guardian_name: name,
    guardian_relation: z.enum(['father', 'mother', 'relative']),
  })
  .strict();
export const classSchema = z.object({ name, campus_id: id, course_id: id }).strict();
export const assignmentSchema = z.object({ role: teacherRole, user_id: id.nullable() }).strict();
export const enrollmentSchema = z.object({ student_id: id }).strict();
export const sessionSchema = z
  .object({
    class_id: id,
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((v) => new Date(v.ends_at) > new Date(v.starts_at), {
    message: '结束时间必须晚于开始时间',
    path: ['ends_at'],
  });
export const attendanceSchema = z
  .object({ status: z.enum(['present', 'absent']), expected_version: z.number().int().min(0) })
  .strict();
export const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(100).optional(),
    include_archived: z.enum(['true', 'false']).optional(),
    campus_id: id.optional(),
    course_id: id.optional(),
    class_id: id.optional(),
    student_id: id.optional(),
    actor_id: id.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    state: z.enum(['upcoming', 'pending', 'partial', 'complete', 'todo']).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '开始日期不能晚于结束日期',
    path: ['to'],
  });
export type ListQuery = z.infer<typeof listQuerySchema>;
export const reportQuerySchema = listQuerySchema.safeExtend({
  teacher_id: id.optional(),
  teacher_role: teacherRole.optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type User = {
  id: string;
  username: string;
  name: string;
  phone: string | null;
  role: Role;
  must_change_password: boolean;
  active: boolean;
};
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };
export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };
