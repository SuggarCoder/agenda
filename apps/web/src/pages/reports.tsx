import { createEffect, createResource, createSignal, For, Show } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { Download, Bell, Info, ArrowRight, History } from 'lucide-solid';
import type { Page } from '@agenda/shared';
import { roleLabels } from '@agenda/shared';
import { api, queryString, dateTime, fullDateTime, dateKey, download, message } from '../api';
import type {
  Lookups,
  Query,
  ReportRow,
  ReportGroup,
  TeacherReportGroup,
  Measures,
  Warning,
  Audit,
} from '../types';
import {
  PageHeading,
  Filters,
  Table,
  Pager,
  Badge,
  StatusBadge,
  Guardian,
  ErrorBox,
  useFeedback,
  Spinner,
} from '../ui';
import { useAuth } from '../auth';

function useExport() {
  const feedback = useFeedback();
  const [busy, setBusy] = createSignal(false);
  return {
    busy,
    run: async (path: string, name: string) => {
      setBusy(true);
      try {
        await download(path, name);
        feedback.toast('导出文件已生成');
      } catch (e) {
        feedback.toast(message(e), 'error');
      } finally {
        setBusy(false);
      }
    },
  };
}
const rate = (value: number | null) => (value === null ? '—' : `${value}%`);

function TeacherSummary(props: {
  rows: TeacherReportGroup[];
  onDetail: (teacher: TeacherReportGroup) => void;
  busy: boolean;
}) {
  return (
    <Table
      rows={props.rows}
      columns={[
        {
          title: '教师 / 角色',
          render: (r) => (
            <div class="cell-stack">
              <strong>{r.teacher_name}</strong>
              <small>{roleLabels[r.teacher_role]}</small>
            </div>
          ),
        },
        { title: '班级数', render: (r) => <span>{r.classes}</span> },
        { title: '学员数（去重）', render: (r) => <span>{r.students}</span> },
        { title: '时段数', render: (r) => <span>{r.sessions}</span> },
        { title: '应到人次', render: (r) => <b>{r.expected}</b> },
        { title: '实到人次', render: (r) => <b class="green-text">{r.present}</b> },
        { title: '缺勤人次', render: (r) => <span class="red-text">{r.absent}</span> },
        { title: '未录入人次', render: (r) => <span class="amber-text">{r.unrecorded}</span> },
        { title: '出勤率', render: (r) => <Badge tone="green">{rate(r.attendance_rate)}</Badge> },
        { title: '录入完成率', render: (r) => <span>{rate(r.recording_rate)}</span> },
        {
          title: '操作',
          render: (r) => (
            <button class="text-btn" disabled={props.busy} onClick={() => props.onDetail(r)}>
              查看学员明细
            </button>
          ),
        },
      ]}
      emptyTitle="当前范围内暂无教师考勤汇总"
      emptyDescription="仅汇总已分配教师且有应到学员的已结束时段，请检查教师分配或调整筛选条件。"
    />
  );
}

export function Reports() {
  const [query, setQuery] = createSignal<Query>({
    page: 1,
    q: '',
    from: dateKey().slice(0, 7) + '-01',
    to: dateKey(),
  });
  const [lookups] = createResource(() => api<Lookups>('/lookups'));
  const [data, { refetch }] = createResource(
    () => queryString(query()),
    (q) =>
      api<
        Page<ReportRow> & {
          summary: Measures;
          groups: ReportGroup[];
          teachers: TeacherReportGroup[];
        }
      >(`/reports/attendance?${q}`),
  );
  const [tab, setTab] = createSignal<'summary' | 'detail' | 'teachers'>('summary');
  const exporter = useExport();
  return (
    <>
      <PageHeading
        eyebrow="数据与记录"
        title="考勤报表"
        description="按班级、班主任或任课老师查看学员考勤，了解出勤与录入管理情况。"
      >
        <button
          class="btn secondary"
          disabled={exporter.busy() || data.loading || !!data.error}
          onClick={() =>
            exporter.run(
              `/reports/attendance/teachers.csv?${queryString(query())}`,
              `教师考勤汇总_${dateKey()}.csv`,
            )
          }
        >
          <Download size={17} />
          导出教师汇总
        </button>
        <button
          class="btn primary"
          disabled={exporter.busy() || data.loading || !!data.error}
          onClick={() =>
            exporter.run(
              `/reports/attendance.csv?${queryString(query())}`,
              `考勤明细_${dateKey()}.csv`,
            )
          }
        >
          {exporter.busy() ? <Spinner /> : <Download size={17} />}导出 CSV
        </button>
      </PageHeading>
      <div class="info-strip">
        <Info size={17} />
        <span>
          仅统计已结束时段，按上课开始日期归属。出勤率 = 实到人次 ÷ 应到人次；未录入单列，不算缺勤。
          录入完成率 =（实到 + 缺勤）÷ 应到人次。
        </span>
      </div>
      <section class="panel report-filters">
        <Filters
          query={query()}
          set={(patch) => setQuery((q) => ({ ...q, ...patch, page: 1 }))}
          lookups={lookups()}
          dates
        >
          <select
            aria-label="教师角色筛选"
            value={query().teacher_role ?? ''}
            onChange={(e) =>
              setQuery((q) => ({
                ...q,
                teacher_role: e.currentTarget.value,
                teacher_id: '',
                page: 1,
              }))
            }
          >
            <option value="">全部教师角色</option>
            <option value="homeroom_teacher">班主任</option>
            <option value="subject_teacher">任课老师</option>
          </select>
          <select
            aria-label="归属教师筛选"
            value={query().teacher_id ?? ''}
            onChange={(e) =>
              setQuery((q) => ({ ...q, teacher_id: e.currentTarget.value, page: 1 }))
            }
          >
            <option value="">全部教师</option>
            <For
              each={lookups()?.teachers.filter(
                (t) => !query().teacher_role || t.role === query().teacher_role,
              )}
            >
              {(t) => (
                <option value={t.id}>
                  {t.name} · {roleLabels[t.role!]}
                  {t.active === false ? '（已停用）' : ''}
                </option>
              )}
            </For>
          </select>
        </Filters>
      </section>
      <p class="attendance-footnote">
        <Info size={14} />
        教师归属按当前班级分配，换老师后历史考勤随班级归属现任老师。仅统计你有权查看的班级；同一班级分别计入班主任和任课老师，教师行之间不可相加作为总计。学员数跨班去重，人次按学员与时段计算。
      </p>
      <Show when={data.error || lookups.error}>
        <ErrorBox error={data.error || lookups.error} retry={refetch} />
      </Show>
      <Show when={data.latest}>
        {(d) => (
          <>
            <div class="report-stats">
              <div>
                <span>应到人次</span>
                <strong>{d().summary.expected}</strong>
                <small>
                  {d().summary.students} 位学员 · {d().summary.sessions} 个时段
                </small>
              </div>
              <div>
                <span>实到人次</span>
                <strong class="green-text">{d().summary.present}</strong>
                <small>已记录出勤</small>
              </div>
              <div>
                <span>缺勤人次</span>
                <strong class="red-text">{d().summary.absent}</strong>
                <small>已明确记录缺勤</small>
              </div>
              <div>
                <span>未录入人次</span>
                <strong class="amber-text">{d().summary.unrecorded}</strong>
                <small>待老师处理</small>
              </div>
              <div>
                <span>出勤率</span>
                <strong>
                  {d().summary.attendance_rate === null ? '—' : `${d().summary.attendance_rate}%`}
                </strong>
                <small>按应到人次计算</small>
              </div>
              <div>
                <span>录入完成率</span>
                <strong>{rate(d().summary.recording_rate)}</strong>
                <small>已录入人次 ÷ 应到人次</small>
              </div>
            </div>
            <section class="panel">
              <div class="tabs">
                <button
                  classList={{ active: tab() === 'summary' }}
                  onClick={() => setTab('summary')}
                >
                  班级汇总<span>{d().groups.length}</span>
                </button>
                <button classList={{ active: tab() === 'detail' }} onClick={() => setTab('detail')}>
                  逐人明细<span>{d().total}</span>
                </button>
                <button
                  classList={{ active: tab() === 'teachers' }}
                  onClick={() => setTab('teachers')}
                >
                  教师汇总<span>{d().teachers.length}</span>
                </button>
                <span class="tabs-note">{query().campus_id ? '单校区统计' : '全部校区汇总'}</span>
              </div>
              <Show when={data.loading}>
                <div class="info-strip">
                  <Spinner />
                  正在更新报表…
                </div>
              </Show>
              <Show when={tab() === 'teachers'}>
                <TeacherSummary
                  rows={d().teachers}
                  busy={data.loading || !!data.error}
                  onDetail={(teacher) => {
                    setQuery((q) => ({
                      ...q,
                      teacher_id: teacher.teacher_id,
                      teacher_role: teacher.teacher_role,
                      page: 1,
                    }));
                    setTab('detail');
                  }}
                />
              </Show>
              <Show when={tab() !== 'teachers'}>
                <Show
                  when={tab() === 'summary'}
                  fallback={
                    <>
                      <Table
                        rows={d().items}
                        columns={[
                          {
                            title: '学员',
                            render: (r) => (
                              <div class="cell-stack">
                                <strong>{r.student_name}</strong>
                                <small>{r.phone}</small>
                              </div>
                            ),
                          },
                          {
                            title: '班级 / 校区',
                            render: (r) => (
                              <div class="cell-stack">
                                <strong>{r.class_name}</strong>
                                <small>
                                  {r.campus_name} · {r.course_name}
                                </small>
                              </div>
                            ),
                          },
                          {
                            title: '上课时间',
                            render: (r) => (
                              <div class="cell-stack">
                                <span>{dateTime(r.starts_at)}</span>
                                <small>至 {dateTime(r.ends_at)}</small>
                              </div>
                            ),
                          },
                          {
                            title: '当前归属教师',
                            render: (r) => (
                              <div class="cell-stack">
                                <span>班主任：{r.homeroom_name ?? '未分配'}</span>
                                <small>任课老师：{r.subject_name ?? '未分配'}</small>
                              </div>
                            ),
                          },
                          { title: '考勤', render: (r) => <StatusBadge status={r.status} /> },
                          {
                            title: '最后修改',
                            render: (r) => (
                              <div class="cell-stack">
                                <span>{r.updated_by_name ?? '—'}</span>
                                <small>{dateTime(r.updated_at)}</small>
                              </div>
                            ),
                          },
                        ]}
                        emptyTitle="暂无考勤明细"
                      />
                      <Pager
                        page={Number(query().page)}
                        total={d().total}
                        onChange={(page) => setQuery((q) => ({ ...q, page }))}
                      />
                    </>
                  }
                >
                  <Table
                    rows={d().groups}
                    columns={[
                      {
                        title: '班级 / 课程',
                        render: (r) => (
                          <div class="cell-stack">
                            <A class="table-link" href={`/classes/${r.class_id}`}>
                              {r.class_name}
                            </A>
                            <small>{r.course_name}</small>
                          </div>
                        ),
                      },
                      { title: '校区', render: (r) => <span>{r.campus_name}</span> },
                      { title: '应到', render: (r) => <b>{r.expected}</b> },
                      { title: '实到', render: (r) => <b class="green-text">{r.present}</b> },
                      { title: '缺勤', render: (r) => <span class="red-text">{r.absent}</span> },
                      {
                        title: '未录入',
                        render: (r) => <span class="amber-text">{r.unrecorded}</span>,
                      },
                      {
                        title: '出勤率',
                        render: (r) => (
                          <Badge tone="green">
                            {r.attendance_rate === null ? '—' : `${r.attendance_rate}%`}
                          </Badge>
                        ),
                      },
                    ]}
                    emptyTitle="当前范围内没有已结束的考勤时段"
                    emptyDescription="调整日期或筛选条件后再试。"
                  />
                </Show>
              </Show>
            </section>
          </>
        )}
      </Show>
    </>
  );
}
export function Warnings() {
  const [query, setQuery] = createSignal<Query>({ page: 1, q: '' });
  const [lookups] = createResource(() => api<Lookups>('/lookups'));
  const [data, { refetch }] = createResource(
    () => queryString(query()),
    (q) =>
      api<Page<Warning> & { week_start: string; week_end: string; server_now: string }>(
        `/weekly-warnings?${q}`,
      ),
  );
  const exporter = useExport();
  return (
    <>
      <PageHeading
        eyebrow="学员关怀"
        title="每周出勤预警"
        description="及时关注本周尚无出勤记录的学员。"
      >
        <button
          class="btn secondary"
          disabled={exporter.busy()}
          onClick={() =>
            exporter.run(`/weekly-warnings.csv?${queryString(query())}`, `周预警_${dateKey()}.csv`)
          }
        >
          {exporter.busy() ? <Spinner /> : <Download size={17} />}导出名单
        </button>
      </PageHeading>
      <div class="warning-banner">
        <span class="warning-banner-icon">
          <Bell size={25} />
        </span>
        <div>
          <h2>
            本周尚有 <b>{data.latest?.total ?? '—'}</b> 位学员待关注
          </h2>
          <p>任一班级、任一校区本周出勤一次，即可解除该学员的预警。</p>
        </div>
        <Show when={data.latest}>
          {(d) => (
            <Badge tone="amber">
              {dateKey(new Date(d().week_start))} —{' '}
              {dateKey(new Date(new Date(d().week_end).getTime() - 1))}
            </Badge>
          )}
        </Show>
      </div>
      <section class="panel">
        <Filters
          query={query()}
          set={(patch) => setQuery((q) => ({ ...q, ...patch, page: 1 }))}
          lookups={lookups()}
          searchPlaceholder="搜索学员姓名或电话…"
        />
        <Show when={data.error || lookups.error}>
          <ErrorBox error={data.error || lookups.error} retry={refetch} />
        </Show>
        <Table
          rows={data.latest?.items ?? []}
          busy={data.loading}
          columns={[
            {
              title: '学员',
              render: (r) => (
                <div class="name-cell">
                  <span class="table-avatar tan" aria-hidden="true">
                    {r.name.slice(0, 1)}
                  </span>
                  <strong>{r.name}</strong>
                </div>
              ),
            },
            {
              title: '联系电话',
              render: (r) => (
                <a class="phone-link" href={`tel:${r.phone}`}>
                  {r.phone}
                </a>
              ),
            },
            {
              title: '监护人',
              render: (r) => <Guardian name={r.guardian_name} relation={r.guardian_relation} />,
            },
            {
              title: '在读班级',
              render: (r) => (
                <div class="cell-stack">
                  <span>{r.class_names ?? '未分班'}</span>
                  <small>{r.campus_names ?? '—'}</small>
                </div>
              ),
            },
            {
              title: '本周状态',
              render: () => (
                <Badge tone="amber">
                  <span class="status-dot" />
                  尚无出勤
                </Badge>
              ),
            },
          ]}
          emptyTitle="当前范围内没有出勤预警"
          emptyDescription="学员已有本周出勤记录，或当前筛选范围内没有在读学员。"
        />
        <Pager
          page={Number(query().page)}
          total={data.latest?.total ?? 0}
          onChange={(page) => setQuery((q) => ({ ...q, page }))}
        />
      </section>
      <p class="attendance-footnote">
        <Info size={14} />
        自然周为北京时间周一至周日。名单实时计算，校区筛选不会改变全系统出勤判定。
      </p>
    </>
  );
}
export function Audits() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [query, setQuery] = createSignal<Query>({ page: 1, q: '' });
  createEffect(() => {
    const classId = params.class_id;
    const studentId = params.student_id;
    setQuery((q) => ({
      ...q,
      class_id: typeof classId === 'string' ? classId : '',
      student_id: typeof studentId === 'string' ? studentId : '',
      page: 1,
    }));
  });
  const [lookups] = createResource(() => api<Lookups>('/lookups'));
  const [data, { refetch }] = createResource(
    () => queryString(query()),
    (q) => api<Page<Audit>>(`/audit-logs?${q}`),
  );
  return (
    <>
      <PageHeading
        eyebrow="数据与记录"
        title="审计日志"
        description="每一条考勤都有来处，每一次更正都有记录。"
      />
      <div class="info-strip">
        <History size={17} />
        <span>包含首次录入和后续更正。日志只读；教师仅能查看当前所带班级的历史记录。</span>
      </div>
      <section class="panel">
        <Filters
          query={query()}
          set={(patch) => setQuery((q) => ({ ...q, ...patch, page: 1 }))}
          lookups={lookups()}
          dates
          searchPlaceholder="搜索学员、操作者或班级…"
        />
        <Show when={data.error || lookups.error}>
          <ErrorBox error={data.error || lookups.error} retry={refetch} />
        </Show>
        <Table
          rows={data.latest?.items ?? []}
          busy={data.loading}
          columns={[
            {
              title: '操作时间',
              render: (r) => <span class="tabular audit-time">{fullDateTime(r.occurred_at)}</span>,
            },
            {
              title: '学员 / 班级',
              render: (r) => (
                <div class="cell-stack">
                  <strong>{r.student_name}</strong>
                  <small>
                    {r.class_name} · {r.campus_name}
                  </small>
                </div>
              ),
            },
            {
              title: '上课时间',
              render: (r) => (
                <div class="cell-stack">
                  <span>{dateTime(r.starts_at)}</span>
                  <small>至 {dateTime(r.ends_at)}</small>
                </div>
              ),
            },
            {
              title: '操作',
              render: (r) => (
                <Badge tone={r.action === 'create' ? 'green' : 'amber'}>
                  {r.action === 'create' ? '首次录入' : '更正考勤'}
                </Badge>
              ),
            },
            {
              title: '状态变更',
              render: (r) => (
                <div class="status-change">
                  <StatusBadge status={r.old_status} />
                  <ArrowRight size={13} />
                  <StatusBadge status={r.new_status} />
                </div>
              ),
            },
            {
              title: '操作者',
              render: (r) => (
                <div class="cell-stack">
                  <strong>{r.actor_name}</strong>
                  <small>第 {r.version} 版</small>
                </div>
              ),
            },
          ]}
          emptyTitle="暂无审计记录"
          emptyDescription="考勤首次录入或更正后，会自动生成审计日志。"
        />
        <Pager
          page={Number(query().page)}
          total={data.latest?.total ?? 0}
          onChange={(page) => setQuery((q) => ({ ...q, page }))}
        />
      </section>
    </>
  );
}
