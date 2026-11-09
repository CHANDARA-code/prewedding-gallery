import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { adminUser, demoUser, mockApi, page, range, renderApp } from './utils';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

async function selectTwo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Select' }));
  await user.click(await screen.findByRole('button', { name: 'Select Photo 10' }));
  await user.click(screen.getByRole('button', { name: 'Select Photo 8' }));
  return screen.getByRole('toolbar', { name: 'Selected photos' });
}

describe('select mode actions', () => {
  it('lets a guest download the selection as one ZIP, and nothing else', async () => {
    mockApi(({ url }) => (url === '/photos' ? { status: 200, data: page(range(10, 1), null) } : { status: 404 }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute('href') ?? '');
    });
    const user = userEvent.setup();
    renderApp('/');
    const bar = await selectTwo(user);

    expect(within(bar).queryByRole('button', { name: /Favorite selected/ })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /Rotate/ })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Download selected' }));
    await waitFor(() => expect(clicked).toEqual(['/api/v1/photos/download.zip?ids=10,8']));
  });

  it('selects every loaded photo with Ctrl+A / Cmd+A and downloads them as one ZIP', async () => {
    mockApi(({ url }) => (url === '/photos' ? { status: 200, data: page(range(5, 1), null) } : { status: 404 }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute('href') ?? '');
    });
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('button', { name: 'Select' });

    // Not in select mode yet: the shortcut turns it on.
    await user.keyboard('{Control>}a{/Control}');
    const bar = await screen.findByRole('toolbar', { name: 'Selected photos' });
    expect(within(bar).getByText('5 photos selected')).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: /Clear/ }));
    expect(within(bar).getByText('Tap photos to select')).toBeInTheDocument();
    await user.keyboard('{Meta>}a{/Meta}');
    expect(within(bar).getByText('5 photos selected')).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Download selected' }));
    await waitFor(() => expect(clicked).toEqual(['/api/v1/photos/download.zip?ids=5,4,3,2,1']));
  });

  it('favorites and saves the whole selection in one request each', async () => {
    const calls = mockApi(({ method, url }) => {
      if (url === '/auth/me') return { status: 200, data: demoUser };
      if (url === '/photos')
        return {
          status: 200,
          data: page(range(10, 1), null, { isFavorite: false, isSaved: false }),
        };
      if (method === 'POST' && url.endsWith('/batch')) return { status: 200, data: { changed: 2 } };
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/', { token: 'tok' });
    const bar = await selectTwo(user);

    await user.click(within(bar).getByRole('button', { name: 'Favorite selected' }));
    await waitFor(() => {
      const post = calls.find((c) => c.url === '/me/favorites/batch');
      expect(JSON.parse(post!.data as string)).toEqual({
        photoIds: [10, 8],
        on: true,
      });
    });
    // Now all selected are favorites: the same button undoes it.
    expect(await within(bar).findByRole('button', { name: 'Unfavorite selected' })).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Save selected' }));
    await waitFor(() =>
      expect(JSON.parse(calls.find((c) => c.url === '/me/saves/batch')!.data as string)).toEqual({ photoIds: [10, 8], on: true }),
    );
    // A plain user can't rotate or trash.
    expect(within(bar).queryByRole('button', { name: /Rotate/ })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument();
  });

  it('lets an admin rotate and trash the selection', async () => {
    const calls = mockApi(({ method, url, data }) => {
      if (url === '/auth/me') return { status: 200, data: adminUser };
      if (url === '/admin/photos') return { status: 200, data: page(range(10, 1), null) };
      if (method === 'POST' && url === '/admin/photos/rotate') {
        const { photoIds } = JSON.parse(data as string);
        return {
          status: 200,
          data: {
            photos: page(photoIds, null, {
              rotation: 90,
              width: 2000,
              height: 3000,
            }).items,
            failed: [],
          },
        };
      }
      if (method === 'POST' && url === '/admin/photos/trash') return { status: 200, data: { changed: 2 } };
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/', { token: 'tok' });
    const bar = await selectTwo(user);

    await user.click(within(bar).getByRole('button', { name: 'Rotate selected right' }));
    await waitFor(() =>
      expect(JSON.parse(calls.find((c) => c.url === '/admin/photos/rotate')!.data as string)).toEqual({
        photoIds: [10, 8],
        degrees: 90,
      }),
    );
    expect(await screen.findByText(/Rotated 2 photos right/)).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'More actions for selected' }));
    await user.click(await screen.findByRole('menuitem', { name: /Move to trash/ }));
    // antd renders a confirm's title twice (one copy is for screen readers).
    expect((await screen.findAllByText('Move 2 photos to trash?')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(JSON.parse(calls.find((c) => c.url === '/admin/photos/trash')!.data as string)).toEqual({ photoIds: [10, 8] }),
    );
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Selected photos' })).not.toBeInTheDocument());
  });
});

describe('share links', () => {
  const share = {
    id: 3,
    token: 'q8WcR1vX0yKp3mTz5LbN2a',
    path: '/s/q8WcR1vX0yKp3mTz5LbN2a',
    title: 'For Mom',
    visibility: 'private',
    photoCount: 2,
    cover: null,
    createdBy: { id: 2, username: 'demo' },
    createdAt: '2026-11-09T08:00:00.000Z',
    expiresAt: null,
    expired: false,
    canManage: true,
    people: [{ id: 4, username: 'dara' }],
  };

  it('makes a private link from the selection for chosen people', async () => {
    const calls = mockApi(({ method, url }) => {
      if (url === '/auth/me') return { status: 200, data: demoUser };
      if (url === '/photos') return { status: 200, data: page(range(10, 1), null) };
      if (url === '/shares/people')
        return {
          status: 200,
          data: [
            { id: 4, username: 'dara' },
            { id: 5, username: 'tithya' },
          ],
        };
      if (method === 'POST' && url === '/shares') return { status: 201, data: share };
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/', { token: 'tok' });
    const bar = await selectTwo(user);
    expect(within(bar).getByText('2 photos selected')).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: 'Share selected as a link' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share 2 photos' });
    await user.click(within(dialog).getByLabelText('Title (optional)'));
    await user.paste('For Mom');
    await user.click(within(dialog).getByLabelText(/Only people I choose/));
    await user.click(within(dialog).getByRole('combobox', { name: 'People' }));
    await user.click(await screen.findByTitle('dara'));
    await user.click(within(dialog).getByRole('button', { name: /Create link/ }));

    await waitFor(() =>
      expect(JSON.parse(calls.find((c) => c.method === 'POST' && c.url === '/shares')!.data as string)).toEqual({
        title: 'For Mom',
        visibility: 'private',
        userIds: [4],
        photoIds: [10, 8],
        expiresInDays: null,
      }),
    );
    const ready = (await screen.findByText('Your link is ready')).closest('.ant-modal') as HTMLElement;
    expect(within(ready).getByLabelText('Share link')).toHaveValue(`${window.location.origin}/s/${share.token}`);
    expect(within(ready).getByText(/Only dara can open it/)).toBeInTheDocument();
  }, 90_000);

  it('opens a public link for a guest, and asks to log in for a private one', async () => {
    mockApi(({ url }) => {
      if (url === `/shares/${share.token}`)
        return { status: 200, data: { ...share, visibility: 'public', canManage: false, people: undefined } };
      if (url === `/shares/${share.token}/photos`) return { status: 200, data: page([7, 3], null) };
      return { status: 404 };
    });
    renderApp(`/s/${share.token}`);
    expect(await screen.findByRole('heading', { name: 'For Mom' })).toBeInTheDocument();
    expect(screen.getByText('Shared by demo')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open Photo 7' })).toBeInTheDocument();
  });

  it('shows a log-in prompt on a private link for guests', async () => {
    mockApi(({ url }) =>
      url === '/shares/AAAAAAAAAAAAAAAAAAAAAA' ? { status: 401, data: { statusCode: 401, message: 'Log in' } } : { status: 404 },
    );
    renderApp('/s/AAAAAAAAAAAAAAAAAAAAAA');
    expect(await screen.findByText('Log in to see these photos')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Log in' })).toHaveLength(2); // the page's and the header's
  });
});

describe('selecting with the mouse', () => {
  it('starts select mode from the hover check and from Ctrl/⌘-click', async () => {
    mockApi(({ url }) => (url === '/photos' ? { status: 200, data: page(range(6, 1), null) } : { status: 404 }));
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Select Photo 5' }));
    const bar = await screen.findByRole('toolbar', { name: 'Selected photos' });
    expect(within(bar).getByText('1 photo selected')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // it did not open the viewer
    await user.click(screen.getByRole('button', { name: 'Done selecting' }));

    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('button', { name: 'Open Photo 3' }));
    await user.keyboard('{/Control}');
    expect(within(await screen.findByRole('toolbar', { name: 'Selected photos' })).getByText('1 photo selected')).toBeInTheDocument();
    // In select mode a shift-click selects the range from the last one.
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: 'Select Photo 6' }));
    await user.keyboard('{/Shift}');
    expect(screen.getByText('4 photos selected')).toBeInTheDocument();
  });
});
