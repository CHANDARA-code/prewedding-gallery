import { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import { AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { vi } from 'vitest';
import { api } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { App } from '../App';
import type { Photo, PhotoPage, User } from '../api/types';

export interface MockRequest {
  method: string;
  url: string;
  params: Record<string, unknown>;
  data: unknown;
  auth: string | undefined;
}

export type MockHandler = (req: MockRequest) => { status: number; data?: unknown } | Promise<{ status: number; data?: unknown }>;

/** Routes every axios request through `handler`; returns the list of requests seen. */
export function mockApi(handler: MockHandler) {
  const calls: MockRequest[] = [];
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const req: MockRequest = {
      method: (config.method ?? 'get').toUpperCase(),
      url: config.url ?? '',
      params: (config.params ?? {}) as Record<string, unknown>,
      data: config.data,
      auth: AxiosHeaders.from(config.headers).get('Authorization') as string | undefined,
    };
    calls.push(req);
    const res = await handler(req);
    const response = { data: res.data, status: res.status, statusText: String(res.status), headers: {}, config };
    if (res.status >= 400) {
      throw new AxiosError(`Request failed with status code ${res.status}`, 'ERR_BAD_RESPONSE', config, null, response);
    }
    return response;
  };
  return calls;
}

export const demoUser: User = { id: 1, username: 'demo', role: 'user' };
export const adminUser: User = { id: 2, username: 'admin', role: 'admin' };

export function makePhoto(id: number, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    title: null,
    caption: null,
    url: `/uploads/${id}.jpg`,
    thumbUrl: `/uploads/thumbs/${id}.webp`,
    width: 3000,
    height: 2000,
    createdAt: '2026-11-01T08:30:00.000Z',
    deletedAt: null,
    ...extra,
  };
}

export function page(ids: number[], nextCursor: string | null, extra: Partial<Photo> = {}): PhotoPage {
  return { items: ids.map((id) => makePhoto(id, extra)), nextCursor, hasMore: nextCursor !== null };
}

export const range = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

let currentPath = '/';
function LocationProbe() {
  currentPath = useLocation().pathname;
  return null;
}
export const getPath = () => currentPath;

export function renderApp(path = '/', { token }: { token?: string } = {}) {
  if (token) localStorage.setItem('pw_token', token);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui: ReactElement = (
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
              <App />
              <LocationProbe />
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
  return { ...render(ui), queryClient };
}

/** Controllable IntersectionObserver mock. */
export function mockIntersectionObserver() {
  const observers = new Set<{ cb: IntersectionObserverCallback; el: Element[] }>();
  class IO {
    private entry: { cb: IntersectionObserverCallback; el: Element[] };
    constructor(cb: IntersectionObserverCallback) {
      this.entry = { cb, el: [] };
      observers.add(this.entry);
    }
    observe(el: Element) {
      this.entry.el.push(el);
    }
    unobserve() {}
    disconnect() {
      observers.delete(this.entry);
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', IO);
  return {
    /** Fires every live observer as if its target scrolled into view. */
    intersect() {
      for (const o of [...observers]) {
        o.cb(
          o.el.map((target) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry),
          {} as IntersectionObserver,
        );
      }
    },
    get count() {
      return observers.size;
    },
  };
}
