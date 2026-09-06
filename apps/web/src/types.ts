import type { Role } from '@agenda/shared';
export interface Lookup {
  id: string;
  name: string;
  archived_at?: string | null;
  campus_id?: string;
  course_id?: string;
  role?: Role;
  active?: boolean;
}
export interface Lookups {
  campuses: Lookup[];
  courses: Lookup[];
  classes: Lookup[];
  students: Lookup[];
  teachers: Lookup[];
}
export interface CatalogRow extends Lookup {
  created_at: string;
  username?: string;
  phone?: string;
  guardian_name?: string;
  guardian_relation?: 'father' | 'mother' | 'relative';
  must_change_password?: boolean;
  campus_name?: string;
  course_name?: string;
  student_count?: number;
  homeroom_name?: string;
  subject_name?: string;
}
export interface ClassStudent extends CatalogRow {
  enrollment_id: string;
  joined_at: string;
  left_at: string | null;
}
export interface ClassDetail extends CatalogRow {
  teachers: Lookup[];
  students: ClassStudent[];
}
export interface Session {
  id: string;
  class_id: string;
  starts_at: string;
  ends_at: string;
  class_name: string;
  campus_name: string;
  course_name: string;
  campus_id: string;
  course_id: string;
  expected: number;
  recorded: number;
  present: number;
  absent: number;
  unrecorded: number;
  server_now: string;
  can_process: boolean;
  state: 'upcoming' | 'pending' | 'partial' | 'complete';
}
export interface RosterStudent {
  student_id: string;
  name: string;
  phone: string;
  guardian_name: string;
  guardian_relation: 'father' | 'mother' | 'relative';
  record_id: string | null;
  status: 'present' | 'absent' | null;
  version: number;
  updated_at: string | null;
  created_at: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
}
export interface AttendancePage {
  session: Session;
  students: RosterStudent[];
}
export interface Audit {
  id: string;
  session_id: string;
  class_id: string;
  student_id: string;
  actor_id: string;
  actor_name: string;
  student_name: string;
  class_name: string;
  campus_name: string;
  action: 'create' | 'update';
  old_status: 'present' | 'absent' | null;
  new_status: 'present' | 'absent';
  occurred_at: string;
  starts_at: string;
  ends_at: string;
  version: number;
}
export interface Measures {
  expected: number;
  present: number;
  absent: number;
  unrecorded: number;
  students: number;
  sessions: number;
  attendance_rate: number | null;
  recording_rate: number | null;
}
export interface TeacherReportGroup extends Measures {
  teacher_id: string;
  teacher_name: string;
  teacher_role: Exclude<Role, 'admin'>;
  classes: number;
}
export interface ReportGroup extends Measures {
  class_id: string;
  class_name: string;
  campus_id: string;
  campus_name: string;
  course_name: string;
}
export interface ReportRow {
  homeroom_name: string | null;
  subject_name: string | null;
  session_id: string;
  student_id: string;
  student_name: string;
  phone: string;
  starts_at: string;
  ends_at: string;
  class_name: string;
  campus_name: string;
  course_name: string;
  status: 'present' | 'absent' | null;
  updated_at: string | null;
  updated_by_name: string | null;
}
export interface Warning extends CatalogRow {
  class_names: string | null;
  campus_names: string | null;
}
export interface DashboardData {
  classes: number;
  students: number;
  warnings: number;
  pending: number;
  server_now: string;
  week_start: string;
  todo: Session[];
  recent: Audit[];
  trend: { day: string; expected: number; present: number; absent: number; unrecorded: number }[];
}
export type Query = Record<string, string | number | undefined>;
