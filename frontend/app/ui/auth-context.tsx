import { setEditorActor } from './editor-commands';
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { components } from '../api/schema';
import { api } from '../api/client';
type Auth = components['schemas']['AuthView'];
const Context = createContext<{
  auth: Auth | null;
  status: 'loading' | 'ready' | 'error';
  refresh: () => Promise<Auth | null>;
}>({
  auth: null,
  status: 'loading',
  refresh: async () => null,
});
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const { data, error } = await api.GET('/api/v1/auth/me');
      if (current !== generation.current) return null;
      if (error || !data) throw error ?? new Error('Session unavailable');
      setAuth(data);
      setStatus('ready');
      return data;
    } catch {
      if (current === generation.current) setStatus('error');
      return null;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lastochka-auth');
    const update = () => {
      void refresh();
    };
    const changed = () => {
      update();
      channel?.postMessage('changed');
    };
    const visible = () => {
      if (document.visibilityState === 'visible') update();
    };
    window.addEventListener('focus', update);
    window.addEventListener('lastochka:session-expired', update);
    window.addEventListener('lastochka:auth-changed', changed);
    document.addEventListener('visibilitychange', visible);
    if (channel)
      channel.onmessage = () => {
        window.dispatchEvent(new Event('lastochka:auth-context-invalidated'));
        update();
      };
    const interval = setInterval(update, 60000);
    return () => {
      clearInterval(interval);
      channel?.close();
      window.removeEventListener('focus', update);
      window.removeEventListener('lastochka:session-expired', update);
      window.removeEventListener('lastochka:auth-changed', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  useEffect(() => {
    if (auth) setEditorActor(auth.state === 'FULL' ? (auth.account?.id ?? null) : null);
  }, [auth]);
  return <Context.Provider value={{ auth, status, refresh }}>{children}</Context.Provider>;
}
export function useAuth() {
  return useContext(Context);
}
