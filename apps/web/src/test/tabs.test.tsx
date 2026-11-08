import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoUser, getPath, mockApi, page, range, renderApp } from './utils';

function backend() {
  return mockApi(({ method, url, auth }) => {
    if (method === 'POST' && url === '/auth/login') return { status: 200, data: { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600, user: demoUser } };
    if (url === '/auth/me') return auth ? { status: 200, data: demoUser } : { status: 401 };
    if (url === '/photos') return { status: 200, data: page(range(30, 7), null) };
    if (url === '/me/favorites') return auth ? { status: 200, data: page([12, 9], null, { isFavorite: true }) } : { status: 401 };
    if (url === '/me/saves') return auth ? { status: 200, data: page([], null) } : { status: 401 };
    return { status: 404, data: { statusCode: 404, error: 'Not Found', message: 'nope' } };
  });
}

describe('tabs and guest login prompt', () => {
  it('shows All / Favorite / Save tabs and lets a guest browse All', async () => {
    backend();
    renderApp('/');
    for (const name of ['All', 'Favorite', 'Save']) expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open Photo 30' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('prompts a guest to log in on Favorite, then lands on that tab', async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('button', { name: 'Open Photo 30' });

    await user.click(screen.getByRole('tab', { name: 'Favorite' }));
    const dialog = await screen.findByRole('dialog');
    expect(getPath()).toBe('/'); // not navigated yet

    await user.type(within(dialog).getByLabelText('Username'), 'demo');
    await user.type(within(dialog).getByLabelText('Password'), 'password');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(getPath()).toBe('/favorite'));
    expect(await screen.findByRole('button', { name: 'Open Photo 12' })).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/me/favorites')?.auth).toBe('Bearer tok');
  });

  it('shows an inline error on bad credentials', async () => {
    mockApi(({ url }) =>
      url === '/auth/login'
        ? { status: 401, data: { statusCode: 401, error: 'Unauthorized', message: 'Invalid credentials' } }
        : { status: 200, data: page([1], null) },
    );
    const user = userEvent.setup();
    renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Username'), 'demo');
    await user.type(within(dialog).getByLabelText('Password'), 'wrong');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));
    expect(await within(dialog).findByText('Invalid username or password')).toBeInTheDocument();
  });

  it('shows an Empty state with a Log in button on direct navigation as a guest', async () => {
    backend();
    renderApp('/save');
    expect(await screen.findByText('Log in to see your saved photos.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Log in' }).length).toBeGreaterThan(0);
  });

  it('switches tabs for a logged-in user', async () => {
    backend();
    const user = userEvent.setup();
    renderApp('/', { token: 'tok' });
    await screen.findByRole('button', { name: /Account menu for demo/ });
    await user.click(screen.getByRole('tab', { name: 'Save' }));
    await waitFor(() => expect(getPath()).toBe('/save'));
    expect(await screen.findByText('Nothing saved yet. Tap the bookmark on any photo.')).toBeInTheDocument();
  });
});
