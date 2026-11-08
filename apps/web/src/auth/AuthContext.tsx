import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { App } from 'antd';
import { api, setUnauthorizedHandler, tokenStore } from '../api/client';
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
  login: (username: string, password: string) => Promise<User>;
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
  const [ready, setReady] = useState(() => !tokenStore.get());
  const [loginOpen, setLoginOpen] = useState(false);
  const [redirectTo, setRedirectTo] = useState<string | undefined>();

  // Restore a stored session.
  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    api
      .get<User>('/auth/me')
      .then((r) => !cancelled && setUser(r.data))
      .catch(() => {
        tokenStore.clear();
      })
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, []);

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
    async (username: string, password: string) => {
      const { data } = await api.post<LoginResponse>('/auth/login', { username, password });
      tokenStore.set(data.accessToken);
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
    tokenStore.clear();
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
