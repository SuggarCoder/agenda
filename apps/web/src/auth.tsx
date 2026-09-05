import {
  createContext,
  createSignal,
  onMount,
  onCleanup,
  useContext,
  type ParentProps,
  type Accessor,
} from 'solid-js';
import type { User } from '@agenda/shared';
import { api, send } from './api';
interface Auth {
  user: Accessor<User | undefined>;
  ready: Accessor<boolean>;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<Auth>();
export function AuthProvider(props: ParentProps) {
  const [user, setUser] = createSignal<User>();
  const [ready, setReady] = createSignal(false);
  const refresh = async () => {
    try {
      setUser((await api<{ user: User }>('/auth/me', {}, false)).user);
    } catch {
      setUser(undefined);
    } finally {
      setReady(true);
    }
  };
  const expired = () => setUser(undefined);
  onMount(() => {
    void refresh();
    window.addEventListener('agenda:session-expired', expired);
    window.addEventListener('agenda:password-required', refresh);
  });
  onCleanup(() => {
    window.removeEventListener('agenda:session-expired', expired);
    window.removeEventListener('agenda:password-required', refresh);
  });
  return (
    <Context.Provider
      value={{
        user,
        ready,
        refresh,
        login: async (username, password) => {
          setUser(
            (
              await api<{ user: User }>(
                '/auth/login',
                { method: 'POST', body: JSON.stringify({ username, password }) },
                false,
              )
            ).user,
          );
        },
        logout: async () => {
          try {
            await send('/auth/logout', 'POST');
          } finally {
            setUser(undefined);
          }
        },
      }}
    >
      {props.children}
    </Context.Provider>
  );
}
export function useAuth() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('AuthProvider missing');
  return ctx;
}
