import { createResource, createSignal, Show } from 'solid-js';
import { Plus, Pencil, Archive, KeyRound, UserRoundCheck, ShieldCheck } from 'lucide-solid';
import {
  namedSchema,
  studentSchema,
  teacherSchema,
  teacherUpdateSchema,
  roleLabels,
  type Page,
} from '@agenda/shared';
import { useAuth } from '../auth';
import { api, send, queryString, dateTime, message } from '../api';
import type { CatalogRow, Query } from '../types';
import {
  PageHeading,
  Table,
  Pager,
  Filters,
  FormDialog,
  Badge,
  Guardian,
  ErrorBox,
  Empty,
  useFeedback,
  type Field,
  type Column,
} from '../ui';

type Entity = 'campuses' | 'courses' | 'students' | 'users';
const titles: Record<Entity, { title: string; singular: string; description: string }> = {
  campuses: {
    title: '校区管理',
    singular: '校区',
    description: '统一管理各校区，让班级与考勤有清晰的归属。',
  },
  courses: {
    title: '课程管理',
    singular: '课程',
    description: '维护课程信息，同一课程可以在多个校区开设班级。',
  },
  students: {
    title: '学员档案',
    singular: '学员',
    description: '记录学员与监护人信息，分班请前往班级详情。',
  },
  users: {
    title: '教师账号',
    singular: '教师',
    description: '管理班主任与任课老师账号，班级操作权限由教师分配决定。',
  },
};
export function Catalog(props: { entity: Entity }) {
  const auth = useAuth();
  const feedback = useFeedback();
  const [query, setQuery] = createSignal<Query>({ page: 1, q: '' });
  const [data, { refetch }] = createResource(
    () => `${props.entity}?${queryString(query())}`,
    (path) => api<Page<CatalogRow>>(`/${path}`),
  );
  const [editing, setEditing] = createSignal<CatalogRow | null | undefined>();
  const title = () => titles[props.entity];
  const change = (patch: Query) => setQuery((q) => ({ ...q, ...patch, page: 1 }));
  const fields = (): Field[] => {
    if (props.entity === 'users')
      return editing()
        ? [
            { key: 'name', label: '姓名' },
            { key: 'phone', label: '手机号', type: 'tel' },
            {
              key: 'active',
              label: '账号状态',
              type: 'select',
              options: [
                { value: 'true', label: '正常' },
                { value: 'false', label: '禁用' },
              ],
              hint: '禁用后，该教师所有设备上的登录会立即失效。',
            },
          ]
        : [
            { key: 'username', label: '用户名', placeholder: '字母、数字或下划线，至少 3 位' },
            { key: 'name', label: '姓名' },
            { key: 'phone', label: '手机号', type: 'tel' },
            {
              key: 'role',
              label: '教师角色',
              type: 'select',
              options: [
                { value: 'homeroom_teacher', label: '班主任' },
                { value: 'subject_teacher', label: '任课老师' },
              ],
            },
          ];
    if (props.entity === 'students')
      return [
        { key: 'name', label: '学员姓名' },
        { key: 'phone', label: '联系电话', type: 'tel' },
        { key: 'guardian_name', label: '监护人姓名' },
        {
          key: 'guardian_relation',
          label: '监护人关系',
          type: 'select',
          options: [
            { value: 'father', label: '父' },
            { value: 'mother', label: '母' },
            { value: 'relative', label: '亲属' },
          ],
        },
      ];
    return [
      {
        key: 'name',
        label: `${title().singular}名称`,
        placeholder: `例如：${props.entity === 'campuses' ? '中心校区' : '创意美术'}`,
      },
    ];
  };
  const save = async (values: Record<string, string>) => {
    const body =
      props.entity === 'users'
        ? editing()
          ? teacherUpdateSchema.parse({ ...values, active: values.active === 'true' })
          : teacherSchema.parse(values)
        : props.entity === 'students'
          ? studentSchema.parse(values)
          : namedSchema.parse(values);
    await send(
      `/${props.entity}${editing() ? `/${editing()!.id}` : ''}`,
      editing() ? 'PATCH' : 'POST',
      body,
    );
    await refetch();
    feedback.toast(`${title().singular}已${editing() ? '更新' : '创建'}`);
  };
  const archive = async (row: CatalogRow) => {
    if (
      !(await feedback.confirm({
        title: `归档${title().singular}`,
        message: `确认归档“${row.name}”？历史考勤与报表会保留。${props.entity === 'students' ? '该学员当前的分班关系会同时结束。' : ''}`,
        label: '确认归档',
      }))
    )
      return;
    try {
      await send(`/${props.entity}/${row.id}/archive`, 'POST');
      await refetch();
      feedback.toast('已归档');
    } catch (e) {
      feedback.toast(message(e), 'error');
    }
  };
  const resetPassword = async (row: CatalogRow) => {
    if (
      !(await feedback.confirm({
        title: '重置教师密码',
        message: `确认将“${row.name}”的密码重置为 Admin@123？原登录会话将失效，下次登录必须修改密码。`,
        label: '重置密码',
      }))
    )
      return;
    try {
      await send(`/users/${row.id}/reset-password`, 'POST');
      feedback.toast('密码已重置为 Admin@123');
      await refetch();
    } catch (e) {
      feedback.toast(message(e), 'error');
    }
  };
  const columns = (): Column<CatalogRow>[] => [
    {
      title: props.entity === 'users' ? '姓名 / 用户名' : `${title().singular}名称`,
      render: (r) => (
        <div class="name-cell">
          <span aria-hidden="true" class={`table-avatar ${props.entity === 'users' ? 'sage' : ''}`}>
            {r.name.slice(0, 1)}
          </span>
          <div>
            <strong>{r.name}</strong>
            <Show when={r.username}>
              <small>{r.username}</small>
            </Show>
          </div>
        </div>
      ),
    },
    ...(props.entity === 'users'
      ? [
          {
            title: '角色',
            render: (r: CatalogRow) => (
              <Badge tone={r.role === 'admin' ? 'green' : 'neutral'}>{roleLabels[r.role!]}</Badge>
            ),
          },
        ]
      : []),
    ...(['users', 'students'].includes(props.entity)
      ? [
          {
            title: '联系电话',
            render: (r: CatalogRow) => <span class="tabular">{r.phone ?? '—'}</span>,
          },
        ]
      : []),
    ...(props.entity === 'students'
      ? [
          {
            title: '监护人',
            render: (r: CatalogRow) => (
              <Guardian name={r.guardian_name} relation={r.guardian_relation} />
            ),
          },
        ]
      : []),
    {
      title: '状态',
      render: (r) => (
        <div class="badge-group">
          <Badge
            tone={
              props.entity === 'users'
                ? r.active
                  ? 'green'
                  : 'neutral'
                : r.archived_at
                  ? 'neutral'
                  : 'green'
            }
          >
            {props.entity === 'users'
              ? r.active
                ? '正常'
                : '已禁用'
              : r.archived_at
                ? '已归档'
                : '正常'}
          </Badge>
          <Show when={r.must_change_password}>
            <Badge tone="amber">待首次改密</Badge>
          </Show>
        </div>
      ),
    },
    {
      title: '创建时间',
      render: (r) => <span class="muted tabular">{dateTime(r.created_at)}</span>,
    },
    {
      title: '操作',
      class: 'actions-column',
      render: (r) => (
        <Show
          when={r.role !== 'admin' && !r.archived_at}
          fallback={
            r.role === 'admin' ? (
              <span class="protected">
                <ShieldCheck size={14} />
                系统账号
              </span>
            ) : (
              <span class="muted">已归档</span>
            )
          }
        >
          <div class="row-actions">
            <button class="text-btn" onClick={() => setEditing(r)}>
              <Pencil size={14} />
              编辑
            </button>
            <Show
              when={props.entity === 'users'}
              fallback={
                <button class="text-btn muted" onClick={() => archive(r)}>
                  <Archive size={14} />
                  归档
                </button>
              }
            >
              <button class="text-btn" onClick={() => resetPassword(r)}>
                <KeyRound size={14} />
                重置密码
              </button>
            </Show>
          </div>
        </Show>
      ),
    },
  ];
  return (
    <Show when={auth.user()?.role === 'admin'} fallback={<Empty title="仅管理员可维护基础资料" />}>
      <PageHeading eyebrow="基础资料" title={title().title} description={title().description}>
        <button class="btn primary" onClick={() => setEditing(null)}>
          <Plus size={17} />
          新建{title().singular}
        </button>
      </PageHeading>
      <Show when={props.entity === 'users'}>
        <div class="info-strip">
          <UserRoundCheck size={17} />
          <span>
            新教师默认密码为 <b>Admin@123</b>，首次登录必须修改。每个账号的角色创建后不可更改。
          </span>
        </div>
      </Show>
      <section class="panel">
        <Filters
          query={query()}
          set={change}
          searchPlaceholder={`搜索${title().singular}${props.entity === 'students' ? '、电话或监护人' : ''}…`}
        >
          <Show when={props.entity !== 'users'}>
            <label class="check-filter">
              <input
                type="checkbox"
                checked={query().include_archived === 'true'}
                onChange={(e) =>
                  change({ include_archived: e.currentTarget.checked ? 'true' : 'false' })
                }
              />
              包含已归档
            </label>
          </Show>
        </Filters>
        <Show when={data.error}>
          <ErrorBox error={data.error} retry={refetch} />
        </Show>
        <Table
          rows={data.latest?.items ?? []}
          columns={columns()}
          busy={data.loading}
          emptyTitle={`还没有${title().singular}记录`}
          emptyDescription={`点击右上角“新建${title().singular}”开始添加，或调整当前筛选条件。`}
        />
        <Pager
          page={Number(query().page)}
          total={data.latest?.total ?? 0}
          onChange={(page) => setQuery((q) => ({ ...q, page }))}
        />
      </section>
      <Show when={editing() !== undefined}>
        <FormDialog
          title={`${editing() ? '编辑' : '新建'}${title().singular}`}
          fields={fields()}
          initial={editing() ? { ...editing() } : undefined}
          onSave={save}
          onClose={() => setEditing(undefined)}
          description={
            props.entity === 'users' && !editing()
              ? '创建后，请将用户名和初始密码交给对应教师。'
              : undefined
          }
        />
      </Show>
    </Show>
  );
}
