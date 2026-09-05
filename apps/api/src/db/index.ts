import pg from 'pg';
import { Kysely, PostgresDialect, type Generated, type ColumnType } from 'kysely';
import type { Role } from '@agenda/shared';
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
interface Base {
  id: Generated<string>;
  created_at: Generated<Timestamp>;
}
export interface UserTable extends Base {
  username: string;
  password_hash: string;
  name: string;
  phone: string | null;
  role: Role;
  must_change_password: Generated<boolean>;
  active: Generated<boolean>;
}
interface Named extends Base {
  name: string;
  archived_at: Timestamp | null;
}
interface ClassTable extends Named {
  campus_id: string;
  course_id: string;
}
interface StudentTable extends Named {
  phone: string;
  guardian_name: string;
  guardian_relation: 'father' | 'mother' | 'relative';
}
interface EnrollmentTable extends Base {
  class_id: string;
  student_id: string;
  joined_at: Generated<Timestamp>;
  left_at: Timestamp | null;
}
interface SessionTable extends Base {
  class_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
}
interface RecordTable extends Base {
  session_id: string;
  student_id: string;
  class_id: string;
  period: string;
  status: 'present' | 'absent';
  version: number;
  created_by: string;
  updated_by: string;
  updated_at: Timestamp;
}
export interface Database {
  users: UserTable;
  campuses: Named;
  courses: Named;
  classes: ClassTable;
  students: StudentTable;
  class_teachers: { class_id: string; user_id: string; role: Exclude<Role, 'admin'> };
  class_enrollments: EnrollmentTable;
  attendance_sessions: SessionTable;
  attendance_records: RecordTable;
  auth_sessions: {
    token_hash: string;
    user_id: string;
    created_at: Generated<Timestamp>;
    expires_at: Timestamp;
  };
  login_attempts: { key: string; attempts: number; window_start: Timestamp };
}
export function connectDatabase(url: string) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
export type Db = Kysely<Database>;
