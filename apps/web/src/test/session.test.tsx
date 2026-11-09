import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { api } from '../api/client';
import { demoUser, mockApi, page, renderApp } from './utils';

/** A JWT-shaped token whose `exp` is `inSeconds` from now (the signature is never checked here). */
const jwt = (name: string, inSeconds: number) =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + inSeconds, n: name })).replace(/=+$/, '')}.s`;

describe('remembered sessions', () => {
  it('signs a remembered user back in from the refresh cookie when the access token is gone', async () => {
    const fresh = jwt('fresh', 3600);
    const calls = mockApi(({ url, auth }) => {
      if (url === '/auth/refresh') return { status: 200, data: { accessToken: fresh, tokenType: 'Bearer', expiresIn: 3600, user: demoUser } };
      if (url === '/auth/me') return auth === `Bearer ${fresh}` ? { status: 200, data: demoUser } : { status: 401 };
      return { status: 200, data: page([1], null) };
    });
    localStorage.setItem('pw_session', '1');
    renderApp('/');
    expect(await screen.findByRole('button', { name: /Account menu for demo/ })).toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
    expect(localStorage.getItem('pw_token')).toBe(fresh);
  });

  it('refreshes an expiring token before the request, once for parallel requests', async () => {
    const fresh = jwt('fresh', 3600);
    localStorage.setItem('pw_token', jwt('old', 10));
    localStorage.setItem('pw_session', '1');
    const calls = mockApi(({ url }) =>
      url === '/auth/refresh' ? { status: 200, data: { accessToken: fresh, user: demoUser } } : { status: 200, data: {} },
    );
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(calls.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
    expect(calls.filter((c) => c.url !== '/auth/refresh').map((c) => c.auth)).toEqual(Array(3).fill(`Bearer ${fresh}`));
  });

  it('retries a request that got 401 after refreshing', async () => {
    const fresh = jwt('fresh', 3600);
    localStorage.setItem('pw_token', jwt('revoked', 3600));
    localStorage.setItem('pw_session', '1');
    const calls = mockApi(({ url, auth }) => {
      if (url === '/auth/refresh') return { status: 200, data: { accessToken: fresh, user: demoUser } };
      return auth === `Bearer ${fresh}` ? { status: 200, data: { ok: true } } : { status: 401 };
    });
    const res = await api.get('/me/favorites');
    expect(res.data).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual(['/me/favorites', '/auth/refresh', '/me/favorites']);
  });

  it('clears the session when the refresh cookie is rejected', async () => {
    localStorage.setItem('pw_token', jwt('old', 3600));
    localStorage.setItem('pw_session', '1');
    mockApi(() => ({ status: 401 }));
    await expect(api.get('/me/saves')).rejects.toMatchObject({ response: { status: 401 } });
    expect(localStorage.getItem('pw_token')).toBeNull();
    expect(localStorage.getItem('pw_session')).toBeNull();
  });

  it('sends "Keep me signed in" with the login, and logout ends the server session', async () => {
    const calls = mockApi(({ url }) => {
      if (url === '/auth/login') return { status: 200, data: { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600, user: demoUser } };
      if (url === '/auth/me') return { status: 200, data: demoUser };
      if (url === '/auth/logout') return { status: 204 };
      return { status: 200, data: page([1], null) };
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Keep me signed in' })).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Keep me signed in' }));
    await user.type(within(dialog).getByLabelText('Username'), 'demo');
    await user.type(within(dialog).getByLabelText('Password'), 'password');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));
    await screen.findByRole('button', { name: /Account menu for demo/ });
    expect(JSON.parse(calls.find((c) => c.url === '/auth/login')!.data as string)).toEqual({ username: 'demo', password: 'password', remember: false });
    expect(localStorage.getItem('pw_session')).toBe('1');

    await user.click(screen.getByRole('button', { name: /Account menu for demo/ }));
    await user.click(await screen.findByText('Log out'));
    await waitFor(() => expect(calls.some((c) => c.url === '/auth/logout')).toBe(true));
    expect(localStorage.getItem('pw_session')).toBeNull();
  });
});
