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
    expect(within(bar).getByText('5 selected')).toBeInTheDocument();

    await user.click(within(bar).getByRole('button', { name: /Clear/ }));
    expect(within(bar).getByText('Tap photos to select')).toBeInTheDocument();
    await user.keyboard('{Meta>}a{/Meta}');
    expect(within(bar).getByText('5 selected')).toBeInTheDocument();

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
