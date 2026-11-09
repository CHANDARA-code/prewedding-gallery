import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_URL } from '../config';
import type { ApiError, LoginResponse, User } from './types';

/** `user` is absent when another tab did the refresh and only the new token is known. */
export type Refreshed = { accessToken: string; user?: User };

export const TOKEN_KEY = 'pw_token';
/** Set while the browser probably holds a refresh cookie (the cookie itself is HttpOnly). */
export const SESSION_KEY = 'pw_session';

function storage(key: string) {
  return {
    get(): string | null {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(value: string) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage unavailable: session lives in memory only */
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const tokenStore = storage(TOKEN_KEY);
export const sessionHint = storage(SESSION_KEY);

/** Seconds since epoch when a JWT expires, or null when it can't be read (tests use opaque tokens). */
export function tokenExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/** Refresh this many seconds before the access token runs out. */
const EARLY_S = 60;
const isFresh = (token: string | null) => {
  if (!token) return false;
  const exp = tokenExpiry(token);
  return exp === null || exp - Date.now() / 1000 > EARLY_S;
};

export const api = axios.create({ baseURL: API_URL });

const isAuthCall = (url?: string) => !!url && /\/auth\/(login|refresh|logout)\b/.test(url);

let onUnauthorized: (() => void) | null = null;

/** AuthContext registers this so a lost session clears the user and reopens the login modal. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

/** Ends the local session: called when the server says the refresh cookie is no good. */
function sessionLost() {
  tokenStore.clear();
  sessionHint.clear();
  onUnauthorized?.();
}

let inflight: Promise<Refreshed | null> | null = null;

async function doRefresh(): Promise<LoginResponse | null> {
  try {
    const { data } = await api.post<LoginResponse>('/auth/refresh');
    tokenStore.set(data.accessToken);
    sessionHint.set('1');
    return data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) return null;
    throw err; // offline or server trouble: keep the session and try again later
  }
}

/**
 * Gets a new access token with the refresh cookie. One refresh at a time per tab, and across tabs
 * via the Web Locks API: a tab that waited reuses the token another tab just stored.
 * Resolves null when the session is over (and has already been cleared).
 */
export function refreshSession(): Promise<Refreshed | null> {
  if (inflight) return inflight;
  const before = tokenStore.get();
  const run = async (): Promise<Refreshed | null> => {
    const now = tokenStore.get();
    if (now && now !== before && isFresh(now)) return { accessToken: now }; // another tab did it
    const res = await doRefresh();
    if (!res) sessionLost();
    return res;
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const p: Promise<Refreshed | null> = (locks ? (locks.request('pw-refresh', run) as unknown as Promise<Refreshed | null>) : run()).finally(() => {
    inflight = null;
  });
  inflight = p;
  return p;
}

/** Refreshes now if the access token is missing or about to expire and a session exists. */
export async function ensureFreshToken(): Promise<string | null> {
  const token = tokenStore.get();
  if (isFresh(token) || !sessionHint.get()) return token;
  try {
    return (await refreshSession())?.accessToken ?? null;
  } catch {
    return token; // network trouble: keep what we have
  }
}

api.interceptors.request.use(async (config) => {
  if (isAuthCall(config.url)) return config;
  // Renew a missing or nearly expired access token before sending, instead of collecting a 401.
  const token = await ensureFreshToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined;
    if (error.response?.status !== 401 || !config || isAuthCall(config.url)) return Promise.reject(error);
    if (sessionHint.get() && !config._retried) {
      config._retried = true;
      try {
        const res = await refreshSession();
        if (res) {
          config.headers.set('Authorization', `Bearer ${res.accessToken}`);
          return api.request(config);
        }
      } catch {
        /* network trouble: report the original 401 */
      }
      return Promise.reject(error);
    }
    if (tokenStore.get()) sessionLost();
    return Promise.reject(error);
  },
);

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Partial<ApiError> | undefined;
    const msg = data?.message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string' && msg) return msg;
    if (err.response?.status === 413) return 'File too large';
    if (err.response?.status === 429) return 'Too many requests, please wait a moment';
  }
  return fallback;
}
