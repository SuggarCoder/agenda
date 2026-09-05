import { createResource, createSignal, For, Show } from 'solid-js';
import { A, useParams } from '@solidjs/router';
import {
  Plus,
  ArrowLeft,
  ArrowRight,
  Pencil,
  Users,
  UserRound,
  CalendarDays,
  Archive,
  UserMinus,
  Building2,
  BookOpen,
} from 'lucide-solid';
import { classSchema, roleLabels, type Page } from '@agenda/shared';
import { useAuth } from '../auth';
import { api, send, queryString, dateTime, timeOnly, message } from '../api';
import type {
  CatalogRow,
  ClassDetail,
  ClassStudent,
  Lookups,
  Query,
  Session,
  Lookup,
} from '../types';
import {
  PageHeading,
  Filters,
  Table,
  Pager,
  FormDialog,
  Badge,
  Guardian,
  SessionBadge,
  ErrorBox,
  Empty,
  useFeedback,
  type Field,
} from '../ui';
import { SessionForm } from './session-form';

function classFields(lookups: Lookups | undefined): Field[] {
  return [
    { key: 'name', label: '班级名称' },
    {
      key: 'campus_id',
      label: '所属校区',
      type: 'select',
      options:
        lookups?.campuses
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: c.name })) ?? [],
    },
    {
      key: 'course_id',
      label: '所属课程',
      type: 'select',
      options:
        lookups?.courses
          .filter((c) => !c.archived_at)
          .map((c) => ({ value: c.id, label: c.name })) ?? [],
    },
  ];
}
export function Classes() {
  const auth = useAuth();
  const feedback = useFeedback();
  const [query, setQuery] = createSignal<Query>({ page: 1, q: '' });
  const [lookups] = createResource(() => api<Lookups>('/lookups'));
  const [data, { refetch }] = createResource(
    () => queryString(query()),
    (q) => api<Page<CatalogRow>>(`/classes?${q}`),
  );
  const [creating, setCreating] = createSignal(false);
  return (
    <>
      <PageHeading
        eyebrow="日常工作"
        title={auth.user()?.role === 'admin' ? '班级管理' : '我的班级'}
        description="课程、学员与老师，在这里连接。"
      >
        <Show when={auth.user()?.role === 'admin'}>
          <button class="btn primary" onClick={() => setCreating(true)}>
            <Plus size={17} />
            新建班级
          </button>
        </Show>
      </PageHeading>
      <section class="panel">
        <Filters
          query={query()}
          set={(patch) => setQuery((q) => ({ ...q, ...patch, page: 1 }))}
          lookups={lookups()}
          hideClasses
          searchPlaceholder="搜索班级名称…"
        >
          <label class="check-filter">
            <input
              type="checkbox"
              checked={query().include_archived === 'true'}
              onChange={(e) =>
                setQuery((q) => ({
                  ...q,
                  page: 1,
                  include_archived: e.currentTarget.checked ? 'true' : 'false',
                }))
              }
            />
            包含已归档
          </label>
        </Filters>
        <Show when={data.error || lookups.error}>
          <ErrorBox error={data.error || lookups.error} retry={refetch} />
        </Show>
        <Table
          rows={data.latest?.items ?? []}
          busy={data.loading}
          columns={[
            {
              title: '班级',
              render: (r) => (
                <A class="name-cell link" href={`/classes/${r.id}`}>
                  <span class="table-avatar sage">
                    <BookOpen size={18} />
                  </span>
                  <div>
                    <strong>{r.name}</strong>
                    <small>{r.course_name}</small>
                  </div>
                </A>
              ),
            },
            { title: '校区', render: (r) => <span>{r.campus_name}</span> },
            {
              title: '在读学员',
              render: (r) => (
                <span>
                  <b>{r.student_count}</b> 人
                </span>
              ),
            },
            {
              title: '班主任',
              render: (r) => (
                <span class={!r.homeroom_name ? 'muted' : ''}>{r.homeroom_name ?? '待分配'}</span>
              ),
            },
            {
              title: '任课老师',
              render: (r) => (
                <span class={!r.subject_name ? 'muted' : ''}>{r.subject_name ?? '待分配'}</span>
              ),
            },
            {
              title: '状态',
              render: (r) => (
                <Badge tone={r.archived_at ? 'neutral' : 'green'}>
                  {r.archived_at ? '已归档' : '进行中'}
                </Badge>
              ),
            },
            {
              title: '操作',
              render: (r) => (
                <A href={`/classes/${r.id}`} class="text-btn">
                  班级详情
                  <ArrowRight size={14} />
                </A>
              ),
            },
          ]}
          emptyTitle="还没有班级"
          emptyDescription={
            auth.user()?.role === 'admin'
              ? '先创建校区和课程，再添加班级并分配教师。'
              : '管理员为你分配班级后，班级会出现在这里。'
          }
        />
        <Pager
          page={Number(query().page)}
          total={data.latest?.total ?? 0}
          onChange={(page) => setQuery((q) => ({ ...q, page }))}
        />
      </section>
      <Show when={creating()}>
        <FormDialog
          title="新建班级"
          fields={classFields(lookups())}
          onClose={() => setCreating(false)}
          onSave={async (values) => {
            await send('/classes', 'POST', classSchema.parse(values));
            await refetch();
            feedback.toast('班级已创建，请进入详情分配老师与学员');
          }}
        />
      </Show>
    </>
  );
}
export function ClassPage() {
  const params = useParams();
  const auth = useAuth();
  const feedback = useFeedback();
  const isAdmin = () => auth.user()?.role === 'admin';
  const [data, { refetch }] = createResource(
    () => params.id,
    (id) => api<ClassDetail>(`/classes/${id}`),
  );
  const [lookups, { refetch: refreshLookups }] = createResource(() => api<Lookups>('/lookups'));
  const [sessions, { refetch: refreshSessions }] = createResource(
    () => params.id,
    (id) => api<Page<Session>>(`/attendance-sessions?class_id=${id}&page_size=5`),
  );
  const [dialog, setDialog] = createSignal<
    'edit' | 'enroll' | 'session' | 'homeroom_teacher' | 'subject_teacher'
  >();
  const [history, setHistory] = createSignal(false);
  const refresh = async () => {
    await Promise.all([refetch(), refreshLookups(), refreshSessions()]);
  };
  const currentStudents = () => data()?.students.filter((s) => !s.left_at) ?? [];
  const withdraw = async (st: ClassStudent) => {
    if (
      !(await feedback.confirm({
        title: '确认退班',
        message: `将“${st.name}”从本班退出？变更立即生效，历史上课名单和考勤会保留。`,
        label: '确认退班',
      }))
    )
      return;
    try {
      await send(`/classes/${params.id}/enrollments/${st.enrollment_id}/withdraw`, 'POST');
      await refresh();
      feedback.toast('已退班，历史记录已保留');
    } catch (e) {
      feedback.toast(message(e), 'error');
    }
  };
  const archive = async () => {
    if (
      !(await feedback.confirm({
        title: '归档班级',
        message: '班级归档后不再接受新的分班与排课，历史数据保留。尚有未结束时段时需先调整排课。',
        label: '归档班级',
      }))
    )
      return;
    try {
      await send(`/classes/${params.id}/archive`, 'POST');
      await refresh();
      feedback.toast('班级已归档');
    } catch (e) {
      feedback.toast(message(e), 'error');
    }
  };
  const teacher = (role: string) => data()?.teachers.find((t) => t.role === role);
  return (
    <>
      <A href="/classes" class="back-link">
        <ArrowLeft size={15} />
        返回班级列表
      </A>
      <Show when={data.error}>
        <ErrorBox error={data.error} retry={refetch} />
      </Show>
      <Show when={data()}>
        {(cl) => (
          <>
            <PageHeading
              eyebrow="班级详情"
              title={cl().name}
              description={`${lookups()?.campuses.find((c) => c.id === cl().campus_id)?.name ?? ''} · ${lookups()?.courses.find((c) => c.id === cl().course_id)?.name ?? ''}`}
            >
              <Badge tone={cl().archived_at ? 'neutral' : 'green'}>
                {cl().archived_at ? '已归档' : '进行中'}
              </Badge>
              <Show when={isAdmin() && !cl().archived_at}>
                <button class="btn secondary" onClick={() => setDialog('edit')}>
                  <Pencil size={16} />
                  编辑班级
                </button>
                <button class="btn primary" onClick={() => setDialog('session')}>
                  <Plus size={17} />
                  新建时段
                </button>
              </Show>
            </PageHeading>
            <div class="class-summary">
              <div class="panel class-count">
                <span class="stat-icon sage">
                  <Users size={22} />
                </span>
                <div>
                  <strong>
                    {currentStudents().length}
                    <small>人</small>
                  </strong>
                  <p>当前在读学员</p>
                </div>
              </div>
              <For each={['homeroom_teacher', 'subject_teacher'] as const}>
                {(role) => (
                  <div class="panel teacher-card">
                    <span class="teacher-avatar">
                      <UserRound size={24} />
                    </span>
                    <div>
                      <small>{roleLabels[role]}</small>
                      <h3>{teacher(role)?.name ?? '尚未分配'}</h3>
                      <Show when={teacher(role)?.active === false}>
                        <Badge>账号已禁用</Badge>
                      </Show>
                    </div>
                    <Show when={isAdmin()}>
                      <button class="text-btn" onClick={() => setDialog(role)}>
                        {teacher(role) ? '更换' : '分配'}
                        <Pencil size={13} />
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <section class="panel section-gap">
              <div class="panel-heading">
                <div>
                  <h2>
                    学员名单 <span class="count-chip">{currentStudents().length}</span>
                  </h2>
                  <p>分班变更即时生效，过去的上课名单不受影响</p>
                </div>
                <div class="row-actions">
                  <label class="check-filter">
                    <input
                      type="checkbox"
                      checked={history()}
                      onChange={(e) => setHistory(e.currentTarget.checked)}
                    />
                    查看退班历史
                  </label>
                  <Show when={isAdmin() && !cl().archived_at}>
                    <button class="btn secondary small" onClick={() => setDialog('enroll')}>
                      <Plus size={15} />
                      添加学员
                    </button>
                  </Show>
                </div>
              </div>
              <Table
                rows={history() ? cl().students : currentStudents()}
                columns={[
                  { title: '学员姓名', render: (st) => <strong>{st.name}</strong> },
                  { title: '电话', render: (st) => <span>{st.phone}</span> },
                  {
                    title: '监护人',
                    render: (st) => (
                      <Guardian name={st.guardian_name} relation={st.guardian_relation} />
                    ),
                  },
                  {
                    title: '入班时间',
                    render: (st) => <span class="muted">{dateTime(st.joined_at)}</span>,
                  },
                  {
                    title: '状态',
                    render: (st) => (
                      <div>
                        <Badge tone={st.left_at ? 'neutral' : 'green'}>
                          {st.left_at ? '已退班' : '在读'}
                        </Badge>
                        <Show when={st.left_at}>
                          <small class="block muted mt-1">{dateTime(st.left_at)}</small>
                        </Show>
                      </div>
                    ),
                  },
                  {
                    title: '操作',
                    render: (st) => (
                      <Show when={isAdmin() && !st.left_at} fallback={<span class="muted">—</span>}>
                        <button class="text-btn muted" onClick={() => withdraw(st)}>
                          <UserMinus size={14} />
                          退班
                        </button>
                      </Show>
                    ),
                  },
                ]}
                emptyTitle="班级还没有学员"
                emptyDescription={
                  isAdmin()
                    ? '先在学员档案创建学员，再添加到本班。'
                    : '管理员添加学员后，名单会展示在这里。'
                }
              />
            </section>
            <section class="panel section-gap">
              <div class="panel-heading">
                <div>
                  <h2>最近考勤时段</h2>
                  <p>所有时间均为北京时间</p>
                </div>
                <A class="text-btn" href={`/sessions?class_id=${params.id}`}>
                  查看全部
                  <ArrowRight size={15} />
                </A>
              </div>
              <Show when={sessions.error}>
                <ErrorBox error={sessions.error} retry={refreshSessions} />
              </Show>
              <Table
                rows={sessions()?.items ?? []}
                columns={[
                  {
                    title: '上课时间',
                    render: (s) => (
                      <span>
                        {dateTime(s.starts_at)}–{timeOnly(s.ends_at)}
                      </span>
                    ),
                  },
                  {
                    title: '应到 / 已录入',
                    render: (s) => (
                      <span>
                        {s.expected} / {s.recorded} 人
                      </span>
                    ),
                  },
                  { title: '状态', render: (s) => <SessionBadge state={s.state} /> },
                  {
                    title: '操作',
                    render: (s) => (
                      <Show when={s.can_process} fallback={<span class="muted">下课后开放</span>}>
                        <A class="text-btn" href={`/attendance/${s.id}`}>
                          {s.state === 'complete' ? '查看 / 更正' : '处理考勤'}
                          <ArrowRight size={14} />
                        </A>
                      </Show>
                    ),
                  },
                ]}
                emptyTitle="还没有考勤时段"
                emptyDescription="管理员可为本班创建明确起止时间的上课时段。"
              />
            </section>
            <Show when={isAdmin() && !cl().archived_at}>
              <div class="archive-area">
                <button class="text-btn muted" onClick={archive}>
                  <Archive size={15} />
                  归档这个班级
                </button>
              </div>
            </Show>
            <Show when={dialog() === 'edit'}>
              <FormDialog
                title="编辑班级"
                fields={classFields(lookups())}
                initial={{ ...cl() }}
                description="已有排课后，所属校区和课程不可更改。"
                onClose={() => setDialog(undefined)}
                onSave={async (values) => {
                  await send(`/classes/${params.id}`, 'PATCH', classSchema.parse(values));
                  await refresh();
                  feedback.toast('班级已更新');
                }}
              />
            </Show>
            <Show when={dialog() === 'enroll'}>
              <FormDialog
                title="添加学员到班级"
                fields={[
                  {
                    key: 'student_id',
                    label: '选择学员',
                    type: 'select',
                    options:
                      lookups()
                        ?.students.filter(
                          (st) => !st.archived_at && !currentStudents().some((s) => s.id === st.id),
                        )
                        .map((st) => ({ value: st.id, label: st.name })) ?? [],
                  },
                ]}
                description="入班从现在生效，学员可以同时在多个班级就读。"
                onClose={() => setDialog(undefined)}
                onSave={async (values) => {
                  await send(`/classes/${params.id}/enrollments`, 'POST', values);
                  await refresh();
                  feedback.toast('学员已加入本班');
                }}
              />
            </Show>
            <Show when={dialog() === 'homeroom_teacher' || dialog() === 'subject_teacher'}>
              <FormDialog
                title={`分配${roleLabels[dialog() as 'homeroom_teacher' | 'subject_teacher']}`}
                initial={{ user_id: teacher(dialog()!)?.id ?? '' }}
                fields={[
                  {
                    key: 'user_id',
                    label: '选择教师',
                    type: 'select',
                    required: false,
                    hint: '留空表示取消分配，更换后原教师立即失去本班操作权限。',
                    options:
                      lookups()
                        ?.teachers.filter((t) => t.active && t.role === dialog())
                        .map((t) => ({ value: t.id, label: t.name })) ?? [],
                  },
                ]}
                onClose={() => setDialog(undefined)}
                onSave={async (values) => {
                  await send(`/classes/${params.id}/teachers`, 'PUT', {
                    role: dialog(),
                    user_id: values.user_id || null,
                  });
                  await refresh();
                  feedback.toast('教师分配已更新');
                }}
              />
            </Show>
            <Show when={dialog() === 'session'}>
              <SessionForm
                classes={lookups()?.classes ?? []}
                classId={params.id}
                onClose={() => setDialog(undefined)}
                onSaved={refresh}
              />
            </Show>
          </>
        )}
      </Show>
    </>
  );
}
