import {
  createEffect,
  createSignal,
  on,
  For,
  Show,
  Suspense,
  ErrorBoundary,
  type ParentProps,
} from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import {
  Sprout,
  LayoutDashboard,
  CalendarCheck2,
  GraduationCap,
  Users,
  Building2,
  BookOpen,
  UserRoundCog,
  ChartNoAxesCombined,
  Bell,
  History,
  ChevronRight,
  Menu,
  X,
  LogOut,
  KeyRound,
} from 'lucide-solid';
import { roleLabels } from '@agenda/shared';
import { useAuth } from './auth';
import { useFeedback, Loading, ErrorBox } from './ui';
import { dateKey, message } from './api';

export function Brand() {
  return (
    <div class="brand">
      <span class="brand-icon">
        <Sprout size={25} />
      </span>
      <div>
        <strong>
          麦卡麦<span>考勤</span>
        </strong>
        <small>QINGHE ATTENDANCE</small>
      </div>
    </div>
  );
}
export function Shell(props: ParentProps) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const feedback = useFeedback();
  const [open, setOpen] = createSignal(false);
  const isAdmin = () => auth.user()?.role === 'admin';
  const nav = [
    {
      label: '日常工作',
      items: [
        { path: '/', label: '工作台', icon: LayoutDashboard },
        { path: '/sessions', label: '考勤时段', icon: CalendarCheck2 },
        { path: '/classes', label: '班级管理', icon: GraduationCap },
      ],
    },
    {
      label: '基础资料',
      admin: true,
      items: [
        { path: '/students', label: '学员档案', icon: Users },
        { path: '/teachers', label: '教师账号', icon: UserRoundCog },
        { path: '/campuses', label: '校区管理', icon: Building2 },
        { path: '/courses', label: '课程管理', icon: BookOpen },
      ],
    },
    {
      label: '数据与记录',
      items: [
        { path: '/reports', label: '考勤报表', icon: ChartNoAxesCombined },
        { path: '/warnings', label: '每周预警', icon: Bell },
        { path: '/audits', label: '审计日志', icon: History },
      ],
    },
  ];
  createEffect(() => {
    if (!auth.ready()) return;
    const user = auth.user();
    const path = location.pathname;
    setOpen(false);
    if (!user && path !== '/login') navigate('/login', { replace: true });
    else if (user?.must_change_password && path !== '/password')
      navigate('/password', { replace: true });
    else if (user && path === '/login') navigate('/', { replace: true });
  });
  const currentTitle = () =>
    nav
      .flatMap((n) => n.items)
      .find((n) =>
        n.path === '/' ? location.pathname === '/' : location.pathname.startsWith(n.path),
      )?.label ?? (location.pathname.startsWith('/attendance') ? '考勤处理' : '账号设置');
  const logout = async () => {
    try {
      await auth.logout();
    } catch (e) {
      feedback.toast(message(e), 'error');
    }
  };
  return (
    <Show
      when={auth.ready()}
      fallback={
        <div class="boot">
          <Brand />
          <Loading />
        </div>
      }
    >
      <Show
        when={auth.user() && location.pathname !== '/login' && !auth.user()?.must_change_password}
        fallback={<Suspense fallback={<Loading />}>{props.children}</Suspense>}
      >
        <div class="app-layout">
          <Show when={open()}>
            <button class="sidebar-scrim" aria-label="关闭导航" onClick={() => setOpen(false)} />
          </Show>
          <aside class={`sidebar ${open() ? 'open' : ''}`}>
            <A href="/" class="brand-link">
              <Brand />
            </A>
            <button
              class="mobile-close icon-btn"
              onClick={() => setOpen(false)}
              aria-label="关闭导航"
            >
              <X size={20} />
            </button>
            <nav aria-label="主导航">
              <For each={nav}>
                {(group) => (
                  <Show when={!group.admin || isAdmin()}>
                    <div class="nav-group">
                      <div class="nav-label">{group.label}</div>
                      <For each={group.items}>
                        {(item) => (
                          <A
                            href={item.path}
                            end={item.path === '/'}
                            activeClass="active"
                            class="nav-item"
                            onClick={() => setOpen(false)}
                          >
                            <item.icon size={19} strokeWidth={1.7} />
                            <span>{item.label}</span>
                          </A>
                        )}
                      </For>
                    </div>
                  </Show>
                )}
              </For>
            </nav>
            <div class="sidebar-note">
              <span class="small-leaf">
                <Sprout size={20} />
              </span>
              <p>
                让每一份成长
                <br />
                都有迹可循。
              </p>
              <span class="sidebar-note-line" />
            </div>
            <div class="sidebar-footer">
              <span class="live-dot" />
              学员考勤系统<span class="version">v1.0</span>
            </div>
          </aside>
          <div class="workspace">
            <header class="topbar">
              <div class="breadcrumb">
                <button
                  class="icon-btn mobile-menu"
                  aria-label="打开导航"
                  onClick={() => setOpen(true)}
                >
                  <Menu size={21} />
                </button>
                <span>教务空间</span>
                <ChevronRight size={13} />
                <b>{currentTitle()}</b>
              </div>
              <div class="topbar-right">
                <span class="today">{dateKey()} · 北京时间</span>
                <A href="/warnings" class="icon-btn notification" aria-label="查看每周预警">
                  <Bell size={19} />
                </A>
                <span class="topbar-divider" />
                <details class="user-menu">
                  <summary>
                    <span class="avatar">{auth.user()?.name.slice(0, 1)}</span>
                    <div>
                      <strong>{auth.user()?.name}</strong>
                      <small>{roleLabels[auth.user()!.role]}</small>
                    </div>
                  </summary>
                  <div class="user-dropdown">
                    <A href="/password">
                      <KeyRound size={16} />
                      修改密码
                    </A>
                    <button onClick={logout}>
                      <LogOut size={16} />
                      退出登录
                    </button>
                  </div>
                </details>
              </div>
            </header>
            <main class="page-content">
              <ErrorBoundary
                fallback={(error, reset) => {
                  createEffect(on(() => location.pathname, reset, { defer: true }));
                  return <ErrorBox error={error} retry={reset} />;
                }}
              >
                <Suspense fallback={<Loading />}>{props.children}</Suspense>
              </ErrorBoundary>
            </main>
            <footer class="page-footer">
              <span>麦卡麦 · 学员考勤</span>
              <span>认真记录，陪伴成长</span>
            </footer>
          </div>
        </div>
      </Show>
    </Show>
  );
}
