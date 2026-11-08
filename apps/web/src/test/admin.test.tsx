import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { adminUser, demoUser, mockApi, page, range, renderApp } from './utils';

describe('admin controls', () => {
  it('are hidden for the demo user', async () => {
    const calls = mockApi(({ url }) => {
      if (url === '/auth/me') return { status: 200, data: demoUser };
      if (url === '/photos') return { status: 200, data: page(range(10, 1), null) };
      return { status: 404 };
    });
    renderApp('/', { token: 'tok' });
    await screen.findByRole('button', { name: /Account menu for demo/ });
    await screen.findByRole('button', { name: 'Open Photo 10' });
    expect(screen.queryByRole('button', { name: 'Photo admin actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Trash')).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/admin'))).toBe(false);
  });

  it('are shown for the admin, with the trash filter driving /admin/photos', async () => {
    const calls = mockApi(({ url }) => {
      if (url === '/auth/me') return { status: 200, data: adminUser };
      if (url === '/admin/photos') return { status: 200, data: page(range(10, 1), null) };
      return { status: 404 };
    });
    renderApp('/', { token: 'tok' });
    await screen.findByRole('button', { name: 'Open Photo 10' });
    expect(screen.getAllByRole('button', { name: 'Photo admin actions' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Trash')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/admin/photos')?.params.status).toBe('active');
  });
});
