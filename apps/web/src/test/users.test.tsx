import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ManagedUser, PermissionInfo, User } from '../api/types';
import { adminUser, demoUser, getPath, mockApi, page, range, renderApp } from './utils';

const catalogue: PermissionInfo[] = [
  { key: 'photos.upload', label: 'Upload photos', grantable: true },
  { key: 'photos.edit', label: 'Edit titles/captions and rotate photos', grantable: true },
  { key: 'photos.delete', label: 'Move photos to trash, restore them and see the trash', grantable: true },
  { key: 'photos.purge', label: 'Permanently delete photos', grantable: true },
  { key: 'photos.export', label: 'Export the photo CSV (original file names)', grantable: true },
  { key: 'users.manage', label: 'Create users and change roles, permissions and passwords', grantable: false },
];
const row = (id: number, username: string, extra: Partial<ManagedUser> = {}): ManagedUser => ({
  id,
  username,
  role: 'user',
  grants: [],
  permissions: [],
  disabled: false,
  createdAt: '2026-11-08T00:00:00.000Z',
  lastLoginAt: null,
  photosUploaded: 0,
  ...extra,
});

describe('Manage users', () => {
  it('lets an admin create a user with permissions and shows the generated password once', async () => {
    const user = userEvent.setup();
    let users = [row(2, 'admin', { role: 'admin', photosUploaded: 300 }), row(1, 'demo')];
    const calls = mockApi(({ method, url, data }) => {
      if (url === '/auth/me') return { status: 200, data: adminUser };
      if (url === '/admin/users/permissions') return { status: 200, data: catalogue };
      if (method === 'GET' && url === '/admin/users') return { status: 200, data: users };
      if (method === 'POST' && url === '/admin/users') {
        const body = JSON.parse(data as string);
        const created = row(3, body.username, { grants: body.grants, permissions: body.grants });
        users = [...users, created];
        return { status: 201, data: { user: created, generatedPassword: 'Gen3ratedPassw0rd' } };
      }
      return { status: 404 };
    });
    renderApp('/users', { token: 'tok' });

    await screen.findByRole('listitem', { name: 'demo' });
    expect(within(screen.getByRole('listitem', { name: 'admin' })).getByText('All permissions')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add user/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add user' });
    await user.type(within(dialog).getByLabelText('Username'), 'Dara');
    await user.click(within(dialog).getByLabelText('Upload photos'));
    await user.click(within(dialog).getByLabelText('Export the photo CSV (original file names)'));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    const creds = await screen.findByRole('dialog', { name: 'dara is ready' });
    expect(within(creds).getByText('Gen3ratedPassw0rd')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.url === '/admin/users')!;
    expect(JSON.parse(post.data as string)).toEqual({ username: 'dara', role: 'user', grants: ['photos.upload', 'photos.export'] });
    await screen.findByRole('listitem', { name: 'dara' });
  });

  it('is not offered to non-admins and the page refuses them', async () => {
    mockApi(({ url }) => {
      if (url === '/auth/me') return { status: 200, data: demoUser };
      return { status: 404 };
    });
    renderApp('/users', { token: 'tok' });
    expect(await screen.findByText('Admins only')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Account menu for demo/ }));
    expect(screen.queryByText('Manage users')).not.toBeInTheDocument();
  });

  it('opens from the admin account menu', async () => {
    const user = userEvent.setup();
    mockApi(({ url }) => {
      if (url === '/auth/me') return { status: 200, data: adminUser };
      if (url === '/admin/photos') return { status: 200, data: page(range(3, 1), null) };
      if (url === '/admin/users') return { status: 200, data: [row(2, 'admin', { role: 'admin' })] };
      if (url === '/admin/users/permissions') return { status: 200, data: catalogue };
      return { status: 404 };
    });
    renderApp('/', { token: 'tok' });
    await user.click(await screen.findByRole('button', { name: /Account menu for admin/ }));
    await user.click(await screen.findByText('Manage users'));
    await waitFor(() => expect(getPath()).toBe('/users'));
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
  });
});

describe('granted permissions', () => {
  it('a user with upload + export sees those controls but no trash or delete', async () => {
    const uploader: User = { id: 5, username: 'dara', role: 'user', permissions: ['photos.upload', 'photos.export'] };
    const calls = mockApi(({ url }) => {
      if (url === '/auth/me') return { status: 200, data: uploader };
      if (url === '/photos') return { status: 200, data: page(range(5, 1), null) };
      return { status: 404 };
    });
    renderApp('/', { token: 'tok' });
    await screen.findByRole('button', { name: 'Open Photo 5' });
    expect(screen.getByRole('button', { name: /Upload/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
    expect(screen.queryByText('Trash')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Photo admin actions' })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url === '/admin/photos')).toBe(false);
  });
});
