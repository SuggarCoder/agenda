import {
  createContext,
  createMemo,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  useContext,
  For,
  Show,
  type JSX,
  type ParentProps,
  type Accessor,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  X,
  Check,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Search,
  Inbox,
  LoaderCircle,
  RotateCw,
} from 'lucide-solid';
import { guardianLabels, statusLabels } from '@agenda/shared';
import type { Lookups, Query } from './types';
import { message } from './api';

export function Spinner() {
  return (
    <span class="spinner" aria-label="加载中">
      <LoaderCircle size={20} />
    </span>
  );
}
export function PageHeading(props: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: JSX.Element;
}) {
  return (
    <div class="page-heading">
      <div>
        <div class="eyebrow">{props.eyebrow ?? '教务管理'}</div>
        <h1>{props.title}</h1>
        <Show when={props.description}>
          <p>{props.description}</p>
        </Show>
      </div>
      <div class="heading-actions">{props.children}</div>
    </div>
  );
}
export function Empty(props: { title?: string; description?: string; children?: JSX.Element }) {
  return (
    <div class="empty-state">
      <span class="empty-icon">
        <Inbox size={30} strokeWidth={1.4} />
      </span>
      <h3>{props.title ?? '暂无记录'}</h3>
      <p>{props.description ?? '试试调整筛选条件，或添加第一条记录。'}</p>
      {props.children}
    </div>
  );
}
export function ErrorBox(props: { error: unknown; retry?: () => unknown }) {
  return (
    <div class="error-box" role="alert">
      <AlertCircle size={18} />
      <span>{message(props.error)}</span>
      <Show when={props.retry}>
        <button class="text-btn" onClick={() => props.retry?.()}>
          <RotateCw size={14} />
          重试
        </button>
      </Show>
    </div>
  );
}
export function Loading() {
  return (
    <div class="loading-state">
      <Spinner />
      <span>正在加载…</span>
    </div>
  );
}
export function Badge(props: { tone?: string; children: JSX.Element }) {
  return <span class={`badge ${props.tone ?? 'neutral'}`}>{props.children}</span>;
}
export function StatusBadge(props: { status: 'present' | 'absent' | null }) {
  return (
    <Badge
      tone={props.status === 'present' ? 'green' : props.status === 'absent' ? 'red' : 'neutral'}
    >
      <span class="status-dot" />
      {statusLabels[props.status ?? 'unrecorded']}
    </Badge>
  );
}
export function SessionBadge(props: { state: string }) {
  const labels: Record<string, string> = {
    upcoming: '尚未可处理',
    pending: '待录入',
    partial: '部分录入',
    complete: '已完成',
  };
  return (
    <Badge
      tone={props.state === 'complete' ? 'green' : props.state === 'upcoming' ? 'neutral' : 'amber'}
    >
      {labels[props.state] ?? props.state}
    </Badge>
  );
}
export function Guardian(props: { name?: string; relation?: keyof typeof guardianLabels }) {
  return (
    <span>
      {props.name ?? '—'}{' '}
      <span class="muted">{props.relation ? `（${guardianLabels[props.relation]}）` : ''}</span>
    </span>
  );
}
export interface Column<T> {
  title: string;
  render: (row: T) => JSX.Element;
  class?: string;
}
export function Table<T>(props: {
  rows: T[];
  columns: Column<T>[];
  emptyTitle?: string;
  emptyDescription?: string;
  busy?: boolean;
}) {
  return (
    <div class={`table-wrap ${props.busy ? 'refreshing' : ''}`} aria-busy={props.busy}>
      <table>
        <thead>
          <tr>
            <For each={props.columns}>
              {(column) => <th class={column.class}>{column.title}</th>}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <For each={props.columns}>
                  {(column) => <td class={column.class}>{column.render(row)}</td>}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={!props.rows.length}>
        <Empty title={props.emptyTitle} description={props.emptyDescription} />
      </Show>
    </div>
  );
}
export function Pager(props: {
  page: number;
  total: number;
  size?: number;
  onChange: (page: number) => void;
}) {
  const pages = () => Math.max(1, Math.ceil(props.total / (props.size ?? 20)));
  return (
    <div class="pagination">
      <span>
        共 <b>{props.total}</b> 条记录
      </span>
      <div>
        <button
          aria-label="上一页"
          disabled={props.page <= 1}
          onClick={() => props.onChange(props.page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {props.page} / {pages()}
        </span>
        <button
          aria-label="下一页"
          disabled={props.page >= pages()}
          onClick={() => props.onChange(props.page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export function Modal(
  props: ParentProps<{ title: string; onClose: () => void; busy?: boolean; wide?: boolean }>,
) {
  let panel!: HTMLDivElement;
  let previous: Element | null;
  let overflow = '';
  onMount(() => {
    previous = document.activeElement;
    overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    queueMicrotask(() =>
      (
        panel.querySelector<HTMLElement>('input,select') ??
        panel.querySelector<HTMLElement>('button')
      )?.focus(),
    );
  });
  onCleanup(() => {
    document.body.style.overflow = overflow;
    if (previous instanceof HTMLElement) previous.focus();
  });
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !props.busy) {
      event.preventDefault();
      props.onClose();
    }
    if (event.key === 'Tab') {
      const nodes = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      );
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  return (
    <Portal>
      <div
        class="modal-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget && !props.busy) props.onClose();
        }}
      >
        <div
          ref={panel}
          class={`modal ${props.wide ? 'wide' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
          onKeyDown={keydown}
        >
          <div class="modal-header">
            <h2>{props.title}</h2>
            <button
              class="icon-btn"
              type="button"
              aria-label="关闭"
              disabled={props.busy}
              onClick={props.onClose}
            >
              <X size={20} />
            </button>
          </div>
          {props.children}
        </div>
      </div>
    </Portal>
  );
}
export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'tel' | 'select' | 'datetime-local' | 'password';
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
}
export function FormDialog(props: {
  title: string;
  fields: Field[];
  initial?: Record<string, unknown>;
  onSave: (values: Record<string, string>) => Promise<unknown>;
  onClose: () => void;
  submitLabel?: string;
  description?: string;
}) {
  const [values, setValues] = createSignal<Record<string, string>>(
    Object.fromEntries(props.fields.map((f) => [f.key, String(props.initial?.[f.key] ?? '')])),
  );
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>();
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await props.onSave(values());
      props.onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={props.title} onClose={props.onClose} busy={busy()}>
      <form onSubmit={submit}>
        <div class="modal-body">
          <Show when={props.description}>
            <p class="form-description">{props.description}</p>
          </Show>
          <Show when={error()}>
            <ErrorBox error={error()} />
          </Show>
          <For each={props.fields}>
            {(field) => (
              <label class="field">
                <span>
                  {field.label}
                  <Show when={field.required !== false}>
                    <i>*</i>
                  </Show>
                </span>
                <Show
                  when={field.type === 'select'}
                  fallback={
                    <input
                      type={field.type ?? 'text'}
                      name={field.key}
                      required={field.required !== false}
                      value={values()[field.key]}
                      maxLength={field.type === 'password' ? 128 : field.type === 'tel' ? 25 : 120}
                      placeholder={field.placeholder}
                      disabled={busy()}
                      onInput={(e) =>
                        setValues((v) => ({ ...v, [field.key]: e.currentTarget.value }))
                      }
                    />
                  }
                >
                  <select
                    name={field.key}
                    required={field.required !== false}
                    value={values()[field.key]}
                    disabled={busy()}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.key]: e.currentTarget.value }))
                    }
                  >
                    <option value="">请选择</option>
                    <For each={field.options}>
                      {(option) => <option value={option.value}>{option.label}</option>}
                    </For>
                  </select>
                </Show>
                <Show when={field.hint}>
                  <small>{field.hint}</small>
                </Show>
              </label>
            )}
          </For>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn secondary" disabled={busy()} onClick={props.onClose}>
            取消
          </button>
          <button class="btn primary" disabled={busy()}>
            {busy() ? <Spinner /> : <Check size={17} />}
            {props.submitLabel ?? '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
type Confirm = { title: string; message: string; danger?: boolean; label?: string };
type Feedback = {
  toast: (text: string, tone?: 'success' | 'error') => void;
  confirm: (options: Confirm) => Promise<boolean>;
};
const FeedbackContext = createContext<Feedback>();
export function FeedbackProvider(props: ParentProps) {
  const [toasts, setToasts] = createSignal<{ id: number; text: string; tone: string }[]>([]);
  const [prompt, setPrompt] = createSignal<Confirm>();
  let resolve: ((value: boolean) => void) | undefined;
  let counter = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const finish = (value: boolean) => {
    resolve?.(value);
    resolve = undefined;
    setPrompt(undefined);
  };
  onCleanup(() => {
    for (const timer of timers) clearTimeout(timer);
    resolve?.(false);
  });
  return (
    <FeedbackContext.Provider
      value={{
        toast: (text, tone = 'success') => {
          const id = ++counter;
          setToasts((v) => [...v, { id, text, tone }]);
          const timer = setTimeout(() => {
            setToasts((v) => v.filter((t) => t.id !== id));
            timers.delete(timer);
          }, 5000);
          timers.add(timer);
        },
        confirm: (options) =>
          new Promise<boolean>((done) => {
            resolve?.(false);
            resolve = done;
            setPrompt(options);
          }),
      }}
    >
      {props.children}
      <Portal>
        <div class="toast-stack" aria-live="polite">
          <For each={toasts()}>
            {(item) => (
              <div class={`toast ${item.tone}`}>
                {item.tone === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}
                <span>{item.text}</span>
                <button
                  aria-label="关闭提示"
                  onClick={() => setToasts((v) => v.filter((t) => t.id !== item.id))}
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Portal>
      <Show when={prompt()}>
        {(p) => (
          <Modal title={p().title} onClose={() => finish(false)}>
            <div class="modal-body">
              <p class="confirm-message">{p().message}</p>
            </div>
            <div class="modal-footer">
              <button class="btn secondary" onClick={() => finish(false)}>
                取消
              </button>
              <button
                class={`btn ${p().danger ? 'danger' : 'primary'}`}
                onClick={() => finish(true)}
              >
                {p().label ?? '确认'}
              </button>
            </div>
          </Modal>
        )}
      </Show>
    </FeedbackContext.Provider>
  );
}
export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('FeedbackProvider missing');
  return ctx;
}

export function SearchField(props: {
  value: string;
  onSearch: (value: string) => void;
  label?: string;
  placeholder?: string;
  delay?: number;
}) {
  const [draft, setDraft] = createSignal(props.value);
  // Only a changed search value may replace the draft, not another filter change.
  const committed = createMemo(() => props.value);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  const cancel = () => clearTimeout(timer);
  onCleanup(cancel);
  createEffect(() => {
    const value = committed();
    cancel();
    setDraft(value);
  });
  const submit = (value: string) => {
    cancel();
    if (composing) return;
    if (props.delay === 0) props.onSearch(value);
    else timer = setTimeout(() => props.onSearch(value), props.delay ?? 300);
  };
  return (
    <div class="filter-search">
      <Search size={17} />
      <input
        aria-label={props.label ?? '搜索'}
        placeholder={props.placeholder ?? '搜索姓名或班级…'}
        value={draft()}
        onCompositionStart={() => {
          composing = true;
          cancel();
        }}
        onCompositionEnd={(e) => {
          composing = false;
          setDraft(e.currentTarget.value);
          submit(e.currentTarget.value);
        }}
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          if (!e.isComposing) submit(e.currentTarget.value);
        }}
      />
    </div>
  );
}

export function Filters(props: {
  query: Query;
  set: (patch: Query) => void;
  lookups?: Lookups;
  dates?: boolean;
  searchPlaceholder?: string;
  children?: JSX.Element;
  hideClasses?: boolean;
}) {
  return (
    <div class="filters">
      <SearchField
        value={String(props.query.q ?? '')}
        onSearch={(q) => props.set({ q })}
        placeholder={props.searchPlaceholder}
      />
      <Show when={props.lookups}>
        <select
          aria-label="校区筛选"
          value={props.query.campus_id ?? ''}
          onChange={(e) => props.set({ campus_id: e.currentTarget.value, class_id: '' })}
        >
          <option value="">全部校区</option>
          <For each={props.lookups?.campuses}>{(c) => <option value={c.id}>{c.name}</option>}</For>
        </select>
        <select
          aria-label="课程筛选"
          value={props.query.course_id ?? ''}
          onChange={(e) => props.set({ course_id: e.currentTarget.value, class_id: '' })}
        >
          <option value="">全部课程</option>
          <For each={props.lookups?.courses}>{(c) => <option value={c.id}>{c.name}</option>}</For>
        </select>
        <Show when={!props.hideClasses}>
          <select
            aria-label="班级筛选"
            value={props.query.class_id ?? ''}
            onChange={(e) => props.set({ class_id: e.currentTarget.value })}
          >
            <option value="">全部班级</option>
            <For
              each={props.lookups?.classes.filter(
                (c) =>
                  (!props.query.campus_id || c.campus_id === props.query.campus_id) &&
                  (!props.query.course_id || c.course_id === props.query.course_id),
              )}
            >
              {(c) => <option value={c.id}>{c.name}</option>}
            </For>
          </select>
        </Show>
      </Show>
      <Show when={props.dates}>
        <div class="date-filter">
          <input
            aria-label="开始日期"
            type="date"
            value={props.query.from ?? ''}
            onInput={(e) => props.set({ from: e.currentTarget.value })}
          />
          <span>至</span>
          <input
            aria-label="结束日期"
            type="date"
            value={props.query.to ?? ''}
            min={String(props.query.from ?? '')}
            onInput={(e) => props.set({ to: e.currentTarget.value })}
          />
        </div>
      </Show>
      {props.children}
    </div>
  );
}
