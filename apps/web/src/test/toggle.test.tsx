import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { demoUser, mockApi, page, renderApp } from './utils';

describe('optimistic favorite / save toggle', () => {
  it('flips the icon immediately and keeps it on success', async () => {
    let resolvePut!: () => void;
    mockApi(({ method, url }) => {
      if (url === '/auth/me') return { status: 200, data: demoUser };
      if (url === '/photos') return { status: 200, data: page([5], null, { isFavorite: false, isSaved: false }) };
      if (method === 'PUT' && url === '/photos/5/favorite')
        return new Promise((r) => (resolvePut = () => r({ status: 204 })));
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/', { token: 'tok' });
    await user.click(await screen.findByRole('button', { name: 'Add to favorites' }));
    // Updated before the server answered.
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
    resolvePut();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove from favorites' })).toBeInTheDocument());
  });

  it('rolls back when the request fails', async () => {
    let failPut!: () => void;
    mockApi(({ method, url }) => {
      if (url === '/auth/me') return { status: 200, data: demoUser };
      if (url === '/photos') return { status: 200, data: page([5], null, { isFavorite: false, isSaved: false }) };
      if (method === 'PUT' && url === '/photos/5/save')
        return new Promise((r) => (failPut = () => r({ status: 500, data: { statusCode: 500, error: 'Internal Server Error', message: 'boom' } })));
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/', { token: 'tok' });
    await user.click(await screen.findByRole('button', { name: 'Save photo' }));
    expect(screen.getByRole('button', { name: 'Remove from saved' })).toBeInTheDocument();
    failPut();
    expect(await screen.findByRole('button', { name: 'Save photo' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens the login modal when a guest taps the heart', async () => {
    mockApi(({ url }) => (url === '/photos' ? { status: 200, data: page([5], null) } : { status: 404 }));
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Add to favorites' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
