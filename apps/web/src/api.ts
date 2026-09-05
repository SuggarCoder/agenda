import type { ApiErrorBody } from '@agenda/shared';
import type { Query } from './types';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  notifyAuth = true,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    const error = (body as ApiErrorBody).error;
    if (notifyAuth && response.status === 401)
      window.dispatchEvent(new Event('agenda:session-expired'));
    if (notifyAuth && error.code === 'PASSWORD_CHANGE_REQUIRED')
      window.dispatchEvent(new Event('agenda:password-required'));
    throw new ApiError(error.code, error.message, response.status);
  }
  return body as T;
}
export const send = <T>(path: string, method: string, body?: unknown) =>
  api<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export function queryString(query: Query) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== '' && value !== undefined) params.set(key, String(value));
  });
  return params.toString();
}
export function message(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues))
    return error.issues.map((i: { message: string }) => i.message).join('；');
  return error instanceof Error ? error.message : '操作未完成，请稍后重试';
}
export async function download(path: string, filename: string) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('agenda:session-expired'));
    const body = await response.json();
    throw new Error(body.error?.message ?? '导出失败');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const dateKey = (date = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(date);
export const dateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '—';
export const fullDateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '—';
export const timeOnly = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
export const localInput = (value: string) => `${dateKey(new Date(value))}T${timeOnly(value)}`;
export const inputToISO = (value: string) => new Date(`${value}:00+08:00`).toISOString();
