import { createResource, createSignal, createEffect, For, Show } from 'solid-js';
import { A, useParams, useSearchParams } from '@solidjs/router';
import {
  Plus,
  ArrowRight,
  ArrowLeft,
  Pencil,
  Trash2,
  LockKeyhole,
  Check,
  X,
  RotateCw,
  History,
  Clock3,
  CheckCheck,
} from 'lucide-solid';
import type { Page } from '@agenda/shared';
import { useAuth } from '../auth';
import { api, send, queryString, dateTime, fullDateTime, timeOnly, message } from '../api';
import type { Session, Lookups, Query, AttendancePage, RosterStudent } from '../types';
import {
  PageHeading,
  Filters,
  SearchField,
  Table,
  Pager,
  SessionBadge,
  StatusBadge,
  Badge,
  ErrorBox,
  Empty,
  useFeedback,
  Spinner,
  Guardian,
} from '../ui';
import { SessionForm } from './session-form';

export function Sessions() {
  const auth = useAuth();
  const feedback = useFeedback();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = createSignal<Query>({ page: 1, q: '' });
  createEffect(() => {
    const classId = searchParams.class_id;
    const state = searchParams.state;
    setQuery((q) => ({
      ...q,
      class_id: typeof classId === 'string' ? classId : '',
      state: typeof state === 'string' ? state : '',
      page: 1,
    }));
  });
  const [data, { refetch }] = createResource(
    () => queryString(query()),
    (q) => api<Page<Session>>(`/attendance-sessions?${q}`),
  );
  const [lookups] = createResource(() => api<Lookups>('/lookups'));
  const [editing, setEditing] = createSignal<Session | null | undefined>();
  const change = (patch: Query) => setQuery((q) => ({ ...q, ...patch, page: 1 }));
  const remove = async (session: Session) => {
    if (
      !(await feedback.confirm({
        title: '删除考勤时段',
        message: `确认删除“${session.class_name}” ${dateTime(session.starts_at)} 的时段？只允许删除尚未录入考勤的时段。`,
        label: '删除时段',
        danger: true,
      }))
    )
      return;
    try {
      await send(`/attendance-sessions/${session.id}`, 'DELETE');
      await refetch();
      feedback.toast('时段已删除');
    } catch (e) {
      feedback.toast(message(e), 'error');
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="日常工作"
        title="考勤时段"
        description="下课后开放考勤处理，每次录入和更正都会留下记录。"
      >
        <button class="btn secondary" onClick={() => refetch()} aria-label="刷新时段">
          <RotateCw size={16} />
          刷新
        </button>
        <Show when={auth.user()?.role === 'admin'}>
          <button class="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            新建时段
          </button>
        </Show>
      </PageHeading>
      <div class="info-strip">
        <Clock3 size={17} />
        <span>所有时间均为北京时间；时段结束前，管理员与教师均不能进入考勤处理。</span>
      </div>
      <section class="panel">
        <Filters
          query={query()}
          set={change}
          lookups={lookups()}
          dates
          searchPlaceholder="搜索班级名称…"
        >
          <select
            aria-label="考勤状态筛选"
            value={query().state ?? ''}
            onChange={(e) => change({ state: e.currentTarget.value })}
          >
            <option value="">全部状态</option>
            <option value="todo">待处理（含部分录入）</option>
            <option value="upcoming">尚未可处理</option>
            <option value="pending">待录入</option>
            <option value="partial">部分录入</option>
            <option value="complete">已完成</option>
          </select>
        </Filters>
        <Show when={data.error || lookups.error}>
          <ErrorBox error={data.error || lookups.error} retry={refetch} />
        </Show>
        <Table
          rows={data.latest?.items ?? []}
          busy={data.loading}
          columns={[
            {
              title: '班级 / 校区',
              render: (s) => (
                <div class="cell-stack">
                  <A class="table-link" href={`/classes/${s.class_id}`}>
                    {s.class_name}
                  </A>
                  <small>
                    {s.campus_name} · {s.course_name}
                  </small>
                </div>
              ),
            },
            {
              title: '上课时间',
              render: (s) => (
                <div class="cell-stack tabular">
                  <strong>{dateTime(s.starts_at)}</strong>
                  <small>至 {dateTime(s.ends_at)}</small>
                </div>
              ),
            },
            {
              title: '考勤进度',
              render: (s) => (
                <div class="session-progress">
                  <span>
                    <b>{s.recorded}</b> / {s.expected} 人
                  </span>
                  <progress value={s.recorded} max={s.expected || 1} />
                </div>
              ),
            },
            { title: '状态', render: (s) => <SessionBadge state={s.state} /> },
            {
              title: '操作',
              class: 'actions-column',
              render: (s) => (
                <div class="row-actions">
                  <Show
                    when={s.can_process}
                    fallback={
                      <span class="locked-label">
                        <LockKeyhole size={13} />
                        下课后开放
                      </span>
                    }
                  >
                    <A class="text-btn" href={`/attendance/${s.id}`}>
                      {s.state === 'complete' ? '查看 / 更正' : '处理考勤'}
                      <ArrowRight size={14} />
                    </A>
                  </Show>
                  <Show when={auth.user()?.role === 'admin' && s.recorded === 0}>
                    <button
                      class="icon-btn"
                      aria-label={`编辑 ${s.class_name} 时段`}
                      title="编辑时段"
                      onClick={() => setEditing(s)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      class="icon-btn danger-text"
                      aria-label={`删除 ${s.class_name} 时段`}
                      title="删除时段"
                      onClick={() => remove(s)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </Show>
                </div>
              ),
            },
          ]}
          emptyTitle="暂无考勤时段"
          emptyDescription={
            auth.user()?.role === 'admin'
              ? '先创建班级并添加学员，再安排考勤时段。'
              : '管理员排课并为你分配班级后，时段会出现在这里。'
          }
        />
        <Pager
          page={Number(query().page)}
          total={data.latest?.total ?? 0}
          onChange={(page) => setQuery((q) => ({ ...q, page }))}
        />
      </section>
      <Show when={editing() !== undefined}>
        <SessionForm
          classes={lookups()?.classes ?? []}
          classId={String(query().class_id ?? '')}
          session={editing() ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={refetch}
        />
      </Show>
    </>
  );
}
export function Attendance() {
  const params = useParams();
  const feedback = useFeedback();
  const [data, { refetch }] = createResource(
    () => params.id,
    (id) => api<AttendancePage>(`/attendance-sessions/${id}/attendance`),
  );
  // Preserve the roster during saves, but never show the previous session on navigation.
  const current = () => (data.latest?.session.id === params.id ? data.latest : data());
  const [q, setQ] = createSignal('');
  const [filter, setFilter] = createSignal('');
  const [saving, setSaving] = createSignal(new Set<string>());
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const counts = () => {
    const students = current()?.students ?? [];
    return {
      expected: students.length,
      present: students.filter((s) => s.status === 'present').length,
      absent: students.filter((s) => s.status === 'absent').length,
      unrecorded: students.filter((s) => !s.status).length,
    };
  };
  const rows = () =>
    current()?.students.filter(
      (s) =>
        (!q() || s.name.includes(q()) || s.phone.includes(q())) &&
        (!filter() || (s.status ?? 'unrecorded') === filter()),
    ) ?? [];
  const refresh = async () => {
    await refetch();
    setErrors({});
  };
  const save = async (student: RosterStudent, status: 'present' | 'absent') => {
    if (saving().has(student.student_id)) return;
    setSaving((s) => new Set([...s, student.student_id]));
    setErrors((e) => ({ ...e, [student.student_id]: '' }));
    try {
      await send(`/attendance-sessions/${params.id}/records/${student.student_id}`, 'PUT', {
        status,
        expected_version: student.version,
      });
      await refetch();
      feedback.toast(`${student.name} · 已记为${status === 'present' ? '出勤' : '缺勤'}`);
    } catch (e) {
      setErrors((v) => ({ ...v, [student.student_id]: message(e) }));
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(student.student_id);
        return next;
      });
    }
  };
  return (
    <>
      <A href="/sessions" class="back-link">
        <ArrowLeft size={15} />
        返回考勤时段
      </A>
      <Show when={data.error}>
        <ErrorBox error={data.error} retry={refetch} />
      </Show>
      <Show when={current()}>
        {(d) => (
          <>
            <PageHeading
              eyebrow="课后考勤"
              title={d().session.class_name}
              description={`${d().session.campus_name} · ${dateTime(d().session.starts_at)} 至 ${dateTime(d().session.ends_at)}`}
            >
              <A href={`/audits?class_id=${d().session.class_id}`} class="btn secondary">
                <History size={16} />
                班级审计
              </A>
              <button class="btn secondary" disabled={saving().size > 0} onClick={refresh}>
                <RotateCw size={16} />
                刷新名单
              </button>
            </PageHeading>
            <div class="attendance-summary">
              <div>
                <span class="summary-label">本次应到</span>
                <strong>
                  {counts().expected}
                  <small>人</small>
                </strong>
              </div>
              <div>
                <span class="summary-label green-text">已出勤</span>
                <strong class="green-text">
                  {counts().present}
                  <small>人</small>
                </strong>
              </div>
              <div>
                <span class="summary-label red-text">已缺勤</span>
                <strong class="red-text">
                  {counts().absent}
                  <small>人</small>
                </strong>
              </div>
              <div>
                <span class="summary-label">待录入</span>
                <strong>
                  {counts().unrecorded}
                  <small>人</small>
                </strong>
              </div>
              <div class="attendance-completion">
                <Show
                  when={counts().unrecorded === 0}
                  fallback={
                    <>
                      <span>
                        {counts().expected - counts().unrecorded} / {counts().expected} 人已录入
                      </span>
                      <progress
                        value={counts().expected - counts().unrecorded}
                        max={counts().expected || 1}
                      />
                    </>
                  }
                >
                  <Badge tone="green">
                    <CheckCheck size={14} />
                    本次考勤已完成
                  </Badge>
                </Show>
              </div>
            </div>
            <div class="info-strip">
              <CheckCheck size={17} />
              <span>点击出勤或缺勤即可逐人保存。未选择的学员保持“未录入”，不会自动计为缺勤。</span>
            </div>
            <section class="panel">
              <div class="filters">
                <SearchField
                  label="搜索本次学员"
                  placeholder="搜索学员姓名或电话…"
                  value={q()}
                  onSearch={setQ}
                  delay={0}
                />
                <select
                  aria-label="学员考勤状态"
                  value={filter()}
                  onChange={(e) => setFilter(e.currentTarget.value)}
                >
                  <option value="">全部学员</option>
                  <option value="unrecorded">未录入</option>
                  <option value="present">出勤</option>
                  <option value="absent">缺勤</option>
                </select>
                <span class="filter-count">当前显示 {rows().length} 人</span>
              </div>
              <Show
                when={d().students.length}
                fallback={
                  <Empty
                    title="本时段没有应考勤学员"
                    description="本时段开始时没有有效分班学员，无需录入。请检查排课时间和分班记录。"
                  />
                }
              >
                <div class="attendance-roster">
                  <div class="roster-labels">
                    <span>学员信息</span>
                    <span>当前状态</span>
                    <span>记录考勤</span>
                    <span>最后修改</span>
                  </div>
                  <For each={rows()}>
                    {(student) => (
                      <div
                        class="roster-entry"
                        classList={{ 'has-error': !!errors()[student.student_id] }}
                      >
                        <div class="roster-main">
                          <div class="name-cell">
                            <span class="table-avatar" aria-hidden="true">
                              {student.name.slice(0, 1)}
                            </span>
                            <div>
                              <strong>{student.name}</strong>
                              <small>
                                {student.phone} · {student.guardian_name}（
                                {student.guardian_relation === 'father'
                                  ? '父'
                                  : student.guardian_relation === 'mother'
                                    ? '母'
                                    : '亲属'}
                                ）
                              </small>
                            </div>
                          </div>
                          <StatusBadge status={student.status} />
                          <div class="attendance-choices" aria-label={`${student.name} 考勤`}>
                            <button
                              class={`attendance-choice present ${student.status === 'present' ? 'selected' : ''}`}
                              aria-pressed={student.status === 'present'}
                              disabled={
                                saving().has(student.student_id) || student.status === 'present'
                              }
                              onClick={() => save(student, 'present')}
                            >
                              <Check size={17} />
                              出勤
                            </button>
                            <button
                              class={`attendance-choice absent ${student.status === 'absent' ? 'selected' : ''}`}
                              aria-pressed={student.status === 'absent'}
                              disabled={
                                saving().has(student.student_id) || student.status === 'absent'
                              }
                              onClick={() => save(student, 'absent')}
                            >
                              <X size={17} />
                              缺勤
                            </button>
                          </div>
                          <div class="last-edit">
                            <Show
                              when={saving().has(student.student_id)}
                              fallback={
                                <>
                                  <span>{student.updated_by_name ?? '尚未录入'}</span>
                                  <small title={fullDateTime(student.updated_at)}>
                                    {dateTime(student.updated_at)}
                                  </small>
                                </>
                              }
                            >
                              <Spinner />
                              <span>保存中…</span>
                            </Show>
                          </div>
                        </div>
                        <Show when={errors()[student.student_id]}>
                          <div class="row-error" role="alert">
                            {errors()[student.student_id]}
                            <button class="text-btn" onClick={refresh}>
                              刷新名单
                            </button>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                  <Show when={!rows().length}>
                    <Empty title="没有符合筛选的学员" description="调整搜索词或考勤状态后再试。" />
                  </Show>
                </div>
              </Show>
            </section>
            <p class="attendance-footnote">
              <History size={14} />
              首次记录和每次更正都会保留操作者与修改历史。
            </p>
          </>
        )}
      </Show>
    </>
  );
}
