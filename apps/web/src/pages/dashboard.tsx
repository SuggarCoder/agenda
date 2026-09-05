import { createResource, For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import {
  ArrowUpRight,
  ArrowRight,
  Users,
  GraduationCap,
  CalendarCheck2,
  Bell,
  Sprout,
  Check,
  Clock3,
  Plus,
} from 'lucide-solid';
import { useAuth } from '../auth';
import { api, dateTime, dateKey, timeOnly } from '../api';
import type { DashboardData } from '../types';
import { PageHeading, ErrorBox, Empty, Badge, SessionBadge } from '../ui';

export function Dashboard() {
  const auth = useAuth();
  const [data, { refetch }] = createResource(() => api<DashboardData>('/dashboard'));
  const max = () => Math.max(1, ...(data()?.trend.map((d) => d.expected) ?? [1]));
  const total = () => data()?.trend.reduce((a, d) => a + d.present, 0) ?? 0;
  return (
    <>
      <PageHeading
        eyebrow="工作台 / OVERVIEW"
        title={`${auth.user()?.name ?? '老师'}，你好`}
        description="每一次出勤，都被认真记录。"
      >
        <A href="/sessions" class="btn primary">
          <CalendarCheck2 size={17} />
          查看考勤时段
          <ArrowUpRight size={16} />
        </A>
      </PageHeading>
      <Show when={data.error}>
        <ErrorBox error={data.error} retry={refetch} />
      </Show>
      <Show when={data()}>
        {(d) => (
          <>
            <div class="welcome-banner">
              <div>
                <span class="banner-kicker">
                  <span class="live-dot" />
                  本周教务
                </span>
                <h2>有序记录，安心教学。</h2>
                <p>
                  本周从 {dateKey(new Date(d().week_start)).replaceAll('-', '.')} 开始，
                  <br class="mobile-break" /> 及时完成课后考勤，关注每一位学员。
                </p>
              </div>
              <div class="banner-callout">
                <span class="banner-sprout">
                  <Sprout size={43} strokeWidth={1.3} />
                </span>
                <span>
                  让陪伴
                  <br />
                  <b>不缺席</b>
                </span>
              </div>
            </div>
            <div class="stat-grid">
              <A href={auth.user()?.role === 'admin' ? '/students' : '/classes'} class="stat-card">
                <div class="stat-label">
                  在读学员
                  <span class="stat-icon sage">
                    <Users size={19} />
                  </span>
                </div>
                <strong>
                  {d().students}
                  <small>人</small>
                </strong>
                <div class="stat-foot">
                  {auth.user()?.role === 'admin' ? '全校区在读学员' : '所带班级在读学员'}
                  <ArrowUpRight size={15} />
                </div>
              </A>
              <A href="/classes" class="stat-card">
                <div class="stat-label">
                  进行中班级
                  <span class="stat-icon blue">
                    <GraduationCap size={20} />
                  </span>
                </div>
                <strong>
                  {d().classes}
                  <small>个</small>
                </strong>
                <div class="stat-foot">
                  当前有效班级
                  <ArrowUpRight size={15} />
                </div>
              </A>
              <A href="/sessions?state=todo" class="stat-card">
                <div class="stat-label">
                  待处理考勤
                  <span class="stat-icon tan">
                    <CalendarCheck2 size={19} />
                  </span>
                </div>
                <strong>
                  {d().pending}
                  <small>次</small>
                </strong>
                <div class="stat-foot">
                  已结束且尚未全部录入
                  <ArrowUpRight size={15} />
                </div>
              </A>
              <A href="/warnings" class="stat-card warning-stat">
                <div class="stat-label">
                  本周出勤预警
                  <span class="stat-icon amber">
                    <Bell size={19} />
                  </span>
                </div>
                <strong>
                  {d().warnings}
                  <small>人</small>
                </strong>
                <div class="stat-foot">
                  本周尚无出勤记录
                  <ArrowUpRight size={15} />
                </div>
              </A>
            </div>
            <div class="dashboard-grid">
              <section class="panel trend-panel">
                <div class="panel-heading">
                  <div>
                    <h2>近 7 日出勤</h2>
                    <p>按上课日期统计 · 出勤人次</p>
                  </div>
                  <Badge>最近 7 天</Badge>
                </div>
                <div class="trend-number">
                  {total()}
                  <span>人次出勤</span>
                </div>
                <div class="chart-legend">
                  <span>
                    <i class="legend-present" />
                    出勤
                  </span>
                  <span>
                    <i class="legend-absent" />
                    缺勤
                  </span>
                  <span>
                    <i class="legend-unrecorded" />
                    未录入
                  </span>
                </div>
                <div class="bar-chart" role="img" aria-label={`最近七天共 ${total()} 人次出勤`}>
                  <div class="chart-grid">
                    <span />
                    <span />
                    <span />
                  </div>
                  <For each={d().trend}>
                    {(day) => (
                      <div class="chart-column">
                        <div
                          class="bar-space"
                          title={`${day.day}：出勤 ${day.present}，缺勤 ${day.absent}，未录入 ${day.unrecorded}`}
                        >
                          <div
                            class="stacked-bar"
                            style={{
                              height: `${Math.max(day.expected ? 3 : 0, (day.expected / max()) * 100)}%`,
                            }}
                          >
                            <div class="bar-missing" style={{ flex: String(day.unrecorded) }} />
                            <div class="bar-absent" style={{ flex: String(day.absent) }} />
                            <div class="bar-present" style={{ flex: String(day.present) }} />
                          </div>
                          <Show when={!day.expected}>
                            <span class="bar-zero" />
                          </Show>
                        </div>
                        <span class={day.day === dateKey() ? 'chart-today' : ''}>
                          {day.day === dateKey() ? '今天' : day.day.slice(5).replace('-', '/')}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </section>
              <section class="panel focus-panel">
                <div class="panel-heading">
                  <div>
                    <h2>每周学员关怀</h2>
                    <p>一次出勤，让关怀有回应</p>
                  </div>
                  <span class="focus-icon">
                    <Bell size={21} />
                  </span>
                </div>
                <div class="focus-count">
                  {d().warnings}
                  <span>位学员待关注</span>
                </div>
                <p class="focus-description">
                  自然周内至少出勤一次。学员在任一校区出勤后，预警会自动解除。
                </p>
                <A href="/warnings" class="focus-link">
                  查看本周预警
                  <ArrowRight size={17} />
                </A>
                <div class="focus-note">
                  <Clock3 size={14} />
                  考勤补录或更正后实时更新
                </div>
              </section>
            </div>
            <div class="dashboard-lower">
              <section class="panel">
                <div class="panel-heading">
                  <div>
                    <h2>
                      待处理考勤 <span class="count-chip">{d().pending}</span>
                    </h2>
                    <p>课后逐人记录，及时完成本次考勤</p>
                  </div>
                  <A href="/sessions" class="text-btn">
                    全部时段
                    <ArrowRight size={15} />
                  </A>
                </div>
                <Show
                  when={d().todo.length}
                  fallback={
                    <Empty
                      title="当前没有待处理考勤"
                      description={
                        d().classes
                          ? '课程结束后，需要处理的考勤会出现在这里。'
                          : '先建立校区、课程和班级，开启考勤管理。'
                      }
                    >
                      <Show when={!d().classes && auth.user()?.role === 'admin'}>
                        <A href="/campuses" class="btn secondary">
                          <Plus size={16} />
                          创建第一个校区
                        </A>
                      </Show>
                    </Empty>
                  }
                >
                  <div class="todo-list">
                    <For each={d().todo}>
                      {(session) => (
                        <A href={`/attendance/${session.id}`} class="todo-row">
                          <span class="todo-icon">
                            <CalendarCheck2 size={22} />
                          </span>
                          <div class="todo-description">
                            <strong>{session.class_name}</strong>
                            <span>
                              {session.campus_name} · {dateTime(session.starts_at)}–
                              {timeOnly(session.ends_at)}
                            </span>
                          </div>
                          <div class="todo-progress">
                            <SessionBadge state={session.state} />
                            <small>
                              {session.recorded} / {session.expected} 人已录入
                            </small>
                          </div>
                          <ChevronArrow />
                        </A>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
              <section class="panel activity-panel">
                <div class="panel-heading">
                  <div>
                    <h2>最近考勤动态</h2>
                    <p>每一笔修改都有记录</p>
                  </div>
                  <A href="/audits" class="icon-btn" aria-label="查看全部审计">
                    <ArrowUpRight size={18} />
                  </A>
                </div>
                <Show
                  when={d().recent.length}
                  fallback={
                    <Empty title="还没有考勤动态" description="首次录入和后续修改会展示在这里。" />
                  }
                >
                  <div class="activity-list">
                    <For each={d().recent}>
                      {(entry) => (
                        <div class="activity-item">
                          <span
                            class={`activity-dot ${entry.new_status === 'present' ? 'green' : 'red'}`}
                          >
                            <Check size={12} />
                          </span>
                          <div>
                            <p>
                              <b>{entry.actor_name}</b>{' '}
                              {entry.action === 'create' ? '记录了' : '更正了'}{' '}
                              <b>{entry.student_name}</b> 的考勤
                            </p>
                            <span>
                              {entry.class_name} ·{' '}
                              {entry.new_status === 'present' ? '出勤' : '缺勤'}
                            </span>
                            <small>{dateTime(entry.occurred_at)}</small>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </div>
          </>
        )}
      </Show>
    </>
  );
}
function ChevronArrow() {
  return <ArrowRight class="todo-arrow" size={17} />;
}
