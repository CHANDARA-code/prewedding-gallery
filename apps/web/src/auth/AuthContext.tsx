import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { App } from 'antd';
import { api, ensureFreshToken, sessionHint, setUnauthorizedHandler, TOKEN_KEY, tokenStore } from '../api/client';
import type { LoginResponse, Permission, User } from '../api/types';
import { LoginModal } from './LoginModal';

interface AuthState {
  user: User | null;
  /** False until a stored token has been checked against `/auth/me`. */
  ready: boolean;
  isAdmin: boolean;
  /** Whether the signed-in user may perform an action (UI hint only; the API enforces it). */
  can: (permission: Permission) => boolean;
  /** Any photo-management permission: shows the per-photo admin menu and the admin fields. */
  canManagePhotos: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<User>;
  logout: () => void;
  /** Opens the login modal; on success navigates to `redirectTo` when given. */
  openLogin: (redirectTo?: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(() => !tokenStore.get() && !sessionHint.get());
  const [loginOpen, setLoginOpen] = useState(false);
  const [redirectTo, setRedirectTo] = useState<string | undefined>();

  // Restore the session: the request interceptor renews an expired access token from the
  // refresh cookie first, so a "remembered" user is signed straight back in.
  useEffect(() => {
    if (!tokenStore.get() && !sessionHint.get()) return;
    let cancelled = false;
    api
      .get<User>('/auth/me')
      .then((r) => !cancelled && setUser(r.data))
      .catch(() => {
        /* the interceptor already cleared a dead session */
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep tabs in step: logging out (or in) in one tab applies to the others.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOKEN_KEY && e.key !== null) return;
      if (!e.newValue && !tokenStore.get()) {
        setUser((u) => {
          if (u) queryClient.clear();
          return null;
        });
      } else if (e.oldValue === null && e.newValue) {
        api
          .get<User>('/auth/me')
          .then((r) => {
            queryClient.clear();
            setUser(r.data);
          })
          .catch(() => {});
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [queryClient]);

  // Renew shortly before the access token expires while the tab is open, and when the tab
  // wakes up (phones suspend timers), so the next click never waits on a refresh.
  useEffect(() => {
    if (!user) return;
    const tick = () => void ensureFreshToken();
    const id = window.setInterval(tick, 5 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      queryClient.clear();
      setRedirectTo(undefined);
      setLoginOpen(true);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const login = useCallback(
    async (username: string, password: string, remember = true) => {
      const { data } = await api.post<LoginResponse>('/auth/login', { username, password, remember });
      tokenStore.set(data.accessToken);
      sessionHint.set('1');
      let me: User = data.user;
      try {
        me = (await api.get<User>('/auth/me')).data;
      } catch {
        /* fall back to the user returned by login */
      }
      queryClient.clear();
      setUser(me);
      setReady(true);
      return me;
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    void api.post('/auth/logout').catch(() => {});
    tokenStore.clear();
    sessionHint.clear();
    setUser(null);
    queryClient.clear();
    message.info('Logged out');
  }, [queryClient, message]);

  const openLogin = useCallback((to?: string) => {
    setRedirectTo(to);
    setLoginOpen(true);
  }, []);

  const value = useMemo<AuthState>(() => {
    const isAdmin = user?.role === 'admin';
    const perms = new Set<Permission>(user?.permissions ?? []);
    const can = (p: Permission) => isAdmin || perms.has(p);
    const canManagePhotos = (['photos.edit', 'photos.delete', 'photos.purge', 'photos.export'] as const).some(can);
    return { user, ready, isAdmin, can, canManagePhotos, login, logout, openLogin };
  }, [user, ready, login, logout, openLogin]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <LoginModal
        open={loginOpen}
        onCancel={() => setLoginOpen(false)}
        onSubmit={login}
        onSuccess={(u) => {
          setLoginOpen(false);
          message.success(`Welcome, ${u.username}`);
          if (redirectTo) navigate(redirectTo);
          setRedirectTo(undefined);
        }}
      />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
