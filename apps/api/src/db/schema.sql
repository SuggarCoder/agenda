CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(40) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name varchar(80) NOT NULL CHECK (length(trim(name)) > 0),
  phone varchar(25),
  role text NOT NULL CHECK (role IN ('admin','homeroom_teacher','subject_teacher')),
  must_change_password boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, role),
  CHECK ((role = 'admin') = (username = 'mkmAdmin')),
  CHECK (role = 'admin' OR (phone IS NOT NULL AND length(trim(phone)) > 0))
);
CREATE UNIQUE INDEX users_single_admin ON users (role) WHERE role = 'admin';
CREATE FUNCTION protect_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'ADMIN_PROTECTED'; END IF;
  IF OLD.role = 'admin' AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.username <> 'mkmAdmin' OR NOT NEW.active) THEN
    RAISE EXCEPTION 'ADMIN_PROTECTED';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role <> OLD.role THEN RAISE EXCEPTION 'ROLE_IMMUTABLE'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_protect_admin BEFORE UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION protect_admin();
CREATE TRIGGER users_no_truncate BEFORE TRUNCATE ON users FOR EACH STATEMENT EXECUTE FUNCTION protect_admin();

CREATE TABLE campuses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(80) NOT NULL UNIQUE CHECK (length(trim(name)) > 0), archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE courses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(80) NOT NULL UNIQUE CHECK (length(trim(name)) > 0), archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(80) NOT NULL CHECK (length(trim(name)) > 0),
  campus_id uuid NOT NULL REFERENCES campuses(id), course_id uuid NOT NULL REFERENCES courses(id),
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campus_id, name)
);
CREATE TABLE class_teachers (
  class_id uuid NOT NULL REFERENCES classes(id), user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('homeroom_teacher','subject_teacher')),
  PRIMARY KEY (class_id, role), FOREIGN KEY (user_id, role) REFERENCES users(id, role)
);
CREATE INDEX class_teachers_user ON class_teachers(user_id, class_id);
CREATE TABLE students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(80) NOT NULL CHECK (length(trim(name)) > 0),
  phone varchar(25) NOT NULL CHECK (length(trim(phone)) > 0), guardian_name varchar(80) NOT NULL CHECK (length(trim(guardian_name)) > 0),
  guardian_relation text NOT NULL CHECK (guardian_relation IN ('father','mother','relative')),
  archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE class_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL REFERENCES classes(id), student_id uuid NOT NULL REFERENCES students(id),
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (left_at IS NULL OR left_at > joined_at),
  EXCLUDE USING gist (class_id WITH =, student_id WITH =, tstzrange(joined_at, left_at, '[)') WITH &&)
);
CREATE INDEX enrollments_student ON class_enrollments(student_id, class_id);
CREATE FUNCTION protect_enrollment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ENROLLMENT_HISTORY_IMMUTABLE'; END IF;
  IF NEW.id <> OLD.id OR NEW.student_id <> OLD.student_id OR NEW.class_id <> OLD.class_id OR NEW.joined_at <> OLD.joined_at
     OR OLD.left_at IS NOT NULL OR NEW.left_at IS NULL OR NEW.left_at < now() THEN
    RAISE EXCEPTION 'ENROLLMENT_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollment_history BEFORE UPDATE OR DELETE ON class_enrollments FOR EACH ROW EXECUTE FUNCTION protect_enrollment_history();

CREATE TABLE attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL REFERENCES classes(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at), UNIQUE(id, class_id)
);
CREATE INDEX sessions_class_start ON attendance_sessions(class_id, starts_at);
CREATE INDEX sessions_end ON attendance_sessions(ends_at);
CREATE TABLE attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES students(id),
  class_id uuid NOT NULL, period tstzrange NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, class_id) REFERENCES attendance_sessions(id, class_id),
  UNIQUE(student_id, session_id),
  CONSTRAINT present_cross_class_overlap EXCLUDE USING gist (student_id WITH =, class_id WITH <>, period WITH &&) WHERE (status = 'present')
);
CREATE INDEX records_session ON attendance_records(session_id);
CREATE INDEX records_student_present ON attendance_records(student_id) WHERE status = 'present';
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES attendance_records(id),
  session_id uuid NOT NULL REFERENCES attendance_sessions(id), class_id uuid NOT NULL REFERENCES classes(id), student_id uuid NOT NULL REFERENCES students(id),
  actor_id uuid NOT NULL REFERENCES users(id), actor_name text NOT NULL, student_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('create','update')), old_status text, new_status text NOT NULL,
  version integer NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audits_class_time ON audit_logs(class_id, occurred_at DESC);
CREATE INDEX audits_student_time ON audit_logs(student_id, occurred_at DESC);
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AUDIT_IMMUTABLE'; END $$;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

CREATE FUNCTION protect_class_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.campus_id <> OLD.campus_id OR NEW.course_id <> OLD.course_id) AND EXISTS(SELECT 1 FROM attendance_sessions WHERE class_id = OLD.id) THEN
    RAISE EXCEPTION 'CLASS_HISTORY_LOCKED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER class_history BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION protect_class_history();
CREATE FUNCTION protect_session_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM attendance_records WHERE session_id = OLD.id)
     AND (TG_OP = 'DELETE' OR NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at OR NEW.class_id <> OLD.class_id OR NEW.id <> OLD.id) THEN
    RAISE EXCEPTION 'SESSION_LOCKED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_history BEFORE UPDATE OR DELETE ON attendance_sessions FOR EACH ROW EXECUTE FUNCTION protect_session_history();

CREATE FUNCTION prepare_attendance_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor users; session attendance_sessions;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ATTENDANCE_DELETE_FORBIDDEN'; END IF;
  SELECT * INTO actor FROM users WHERE id = nullif(current_setting('agenda.actor_id', true), '')::uuid FOR SHARE;
  IF actor.id IS NULL OR NOT actor.active THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF actor.must_change_password THEN RAISE EXCEPTION 'PASSWORD_CHANGE_REQUIRED'; END IF;
  SELECT * INTO session FROM attendance_sessions WHERE id = NEW.session_id FOR UPDATE;
  IF session.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM id FROM classes WHERE id = session.class_id FOR SHARE;
  IF actor.role <> 'admin' AND NOT EXISTS (SELECT 1 FROM class_teachers WHERE class_id = session.class_id AND user_id = actor.id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF now() < session.ends_at THEN RAISE EXCEPTION 'SESSION_NOT_ENDED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM class_enrollments WHERE class_id = session.class_id AND student_id = NEW.student_id
    AND joined_at <= session.starts_at AND (left_at IS NULL OR left_at > session.starts_at)) THEN
    RAISE EXCEPTION 'STUDENT_NOT_ENROLLED';
  END IF;
  NEW.class_id := session.class_id;
  NEW.period := tstzrange(session.starts_at, session.ends_at, '[)');
  NEW.updated_by := actor.id; NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := actor.id; NEW.created_at := now(); NEW.version := 1;
  ELSE
    IF NEW.id <> OLD.id OR NEW.session_id <> OLD.session_id OR NEW.student_id <> OLD.student_id THEN RAISE EXCEPTION 'RECORD_IDENTITY_IMMUTABLE'; END IF;
    IF NEW.status = OLD.status THEN RETURN OLD; END IF;
    NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at; NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_guard BEFORE INSERT OR UPDATE OR DELETE ON attendance_records FOR EACH ROW EXECUTE FUNCTION prepare_attendance_record();
CREATE FUNCTION append_attendance_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO audit_logs(record_id, session_id, class_id, student_id, actor_id, actor_name, student_name, action, old_status, new_status, version)
    VALUES(NEW.id, NEW.session_id, NEW.class_id, NEW.student_id, NEW.updated_by,
      (SELECT name FROM users WHERE id = NEW.updated_by), (SELECT name FROM students WHERE id = NEW.student_id),
      CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status, NEW.version);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_audit AFTER INSERT OR UPDATE ON attendance_records FOR EACH ROW EXECUTE FUNCTION append_attendance_audit();

CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL DEFAULT now());
