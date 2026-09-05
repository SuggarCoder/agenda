import { createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import {
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  Sprout,
  CalendarCheck2,
  Check,
  KeyRound,
  LogOut,
} from 'lucide-solid';
import { passwordSchema } from '@agenda/shared';
import { useAuth } from '../auth';
import { Brand } from '../shell';
import { ErrorBox, Spinner, useFeedback, PageHeading } from '../ui';
import { send } from '../api';

export function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [visible, setVisible] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await auth.login(username(), password());
      navigate(auth.user()?.must_change_password ? '/password' : '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="login-layout">
      <section class="login-story">
        <Brand />
        <div class="story-content">
          <span class="story-kicker">
            <span />
            专注教学，从容管理
          </span>
          <h1>
            每一次到来，
            <br />
            都是成长的<span>印记。</span>
          </h1>
          <p>
            连接校区、班级与老师，
            <br />
            让考勤记录清晰，让学员关怀及时。
          </p>
          <div class="story-illustration" aria-hidden="true">
            <div class="illustration-orbit orbit-one" />
            <div class="illustration-orbit orbit-two" />
            <div class="illustration-card">
              <div class="illustration-card-top">
                <CalendarCheck2 size={22} />
                <span>成长记录</span>
                <span class="illustration-dots">•••</span>
              </div>
              <div class="illustration-week">
                <span>一</span>
                <span>二</span>
                <span>三</span>
                <span>四</span>
                <span>五</span>
              </div>
              <div class="illustration-checks">
                <span>
                  <Check />
                </span>
                <span>
                  <Check />
                </span>
                <span class="check-today">
                  <Sprout />
                </span>
                <span />
                <span />
              </div>
              <div class="illustration-rule" />
              <div class="illustration-caption">
                <span class="live-dot" />
                每一份努力，都值得被看见
              </div>
            </div>
            <div class="floating-leaf">
              <Sprout size={34} />
            </div>
          </div>
        </div>
        <div class="story-footer">
          QINGHE ATTENDANCE <span>为成长，留一份记录。</span>
        </div>
      </section>
      <section class="login-panel">
        <div class="mobile-brand">
          <Brand />
        </div>
        <form class="login-form" onSubmit={submit}>
          <div class="eyebrow">欢迎回来</div>
          <h2>登录教务空间</h2>
          <p class="login-subtitle">使用你的账号，开启今天的工作。</p>
          <Show when={error()}>
            <ErrorBox error={error()} />
          </Show>
          <label class="field">
            <span>用户名</span>
            <input
              name="username"
              autocomplete="username"
              placeholder="请输入用户名"
              required
              maxLength={40}
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              disabled={busy()}
            />
          </label>
          <label class="field">
            <span>密码</span>
            <div class="password-input">
              <input
                name="password"
                autocomplete="current-password"
                type={visible() ? 'text' : 'password'}
                placeholder="请输入密码"
                required
                maxLength={128}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                disabled={busy()}
              />
              <button
                type="button"
                aria-label={visible() ? '隐藏密码' : '显示密码'}
                onClick={() => setVisible(!visible())}
              >
                {visible() ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <button class="btn primary login-submit" disabled={busy()}>
            {busy() ? (
              <Spinner />
            ) : (
              <>
                登录
                <ArrowRight size={19} />
              </>
            )}
          </button>
          <div class="login-help">
            <ShieldCheck size={16} />
            <span>教师账号由管理员创建，首次登录需修改密码。</span>
          </div>
          <div class="login-support">无法登录？请联系系统管理员。</div>
        </form>
        <div class="login-copyright">青禾学员考勤 · 让管理更有温度</div>
      </section>
    </div>
  );
}
export function Password() {
  const auth = useAuth();
  const feedback = useFeedback();
  const navigate = useNavigate();
  const [current, setCurrent] = createSignal('');
  const [next, setNext] = createSignal('');
  const [confirm, setConfirm] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(undefined);
    if (next() !== confirm()) {
      setError(new Error('两次输入的新密码不一致'));
      return;
    }
    setBusy(true);
    try {
      const body = passwordSchema.parse({ currentPassword: current(), newPassword: next() });
      await send('/auth/password', 'POST', body);
      await auth.refresh();
      feedback.toast('密码已修改，请使用新密码重新登录');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class={auth.user()?.must_change_password ? 'password-gate' : ''}>
      <Show when={auth.user()?.must_change_password}>
        <Brand />
      </Show>
      <div class="password-container">
        <PageHeading
          eyebrow="账号安全"
          title={auth.user()?.must_change_password ? '先设置你的专属密码' : '修改登录密码'}
          description={
            auth.user()?.must_change_password
              ? '首次登录需要修改初始密码，完成后即可进入教务空间。'
              : '修改后，所有设备上的旧登录状态都会失效。'
          }
        />
        <form class="panel password-form" onSubmit={submit}>
          <div class="password-symbol">
            <KeyRound size={26} />
          </div>
          <Show when={error()}>
            <ErrorBox error={error()} />
          </Show>
          <label class="field">
            <span>原密码</span>
            <input
              type="password"
              autocomplete="current-password"
              required
              value={current()}
              onInput={(e) => setCurrent(e.currentTarget.value)}
            />
          </label>
          <label class="field">
            <span>新密码</span>
            <input
              type="password"
              autocomplete="new-password"
              minLength={8}
              maxLength={128}
              placeholder="至少 8 位，建议组合使用字母和数字"
              required
              value={next()}
              onInput={(e) => setNext(e.currentTarget.value)}
            />
          </label>
          <label class="field">
            <span>确认新密码</span>
            <input
              type="password"
              autocomplete="new-password"
              minLength={8}
              maxLength={128}
              required
              value={confirm()}
              onInput={(e) => setConfirm(e.currentTarget.value)}
            />
          </label>
          <button class="btn primary" disabled={busy()}>
            {busy() ? <Spinner /> : <ShieldCheck size={17} />}保存新密码
          </button>
        </form>
        <Show when={auth.user()?.must_change_password}>
          <button class="text-btn gate-logout" onClick={() => auth.logout()}>
            <LogOut size={15} />
            退出登录
          </button>
        </Show>
      </div>
    </div>
  );
}
