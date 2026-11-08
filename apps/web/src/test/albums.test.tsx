import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { Album } from '../api/types';
import { adminUser, demoUser, getPath, mockApi, page, range, renderApp } from './utils';

const album = (id: number, extra: Partial<Album> = {}): Album => ({
  id,
  slug: `album-${id}`,
  name: `Album ${id}`,
  description: null,
  hidden: false,
  photoCount: 3,
  cover: { id: 3, thumbUrl: '/uploads/thumbs/3.webp', previewUrl: '/uploads/previews/3.webp', width: 3000, height: 2000 },
  coverPhotoId: null,
  createdAt: '2026-11-08T08:00:00.000Z',
  updatedAt: '2026-11-08T08:00:00.000Z',
  ...extra,
});
const angkor = album(3, { slug: 'barsat-angkor-wat', name: 'Barsat Angkor Wat', description: 'Sunrise at the west gate' });

afterEach(() => localStorage.clear());

describe('albums', () => {
  it('lets a guest browse the Albums tab and open an album', async () => {
    const calls = mockApi(({ url }) => {
      if (url === '/photos') return { status: 200, data: page(range(10, 1), null) };
      if (url === '/albums') return { status: 200, data: [angkor, album(2)] };
      if (url === '/albums/barsat-angkor-wat') return { status: 200, data: angkor };
      if (url === '/albums/barsat-angkor-wat/photos') return { status: 200, data: page([3, 2, 1], null) };
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('tab', { name: /Albums/ }));
    await user.click(await screen.findByRole('link', { name: /Barsat Angkor Wat/ }));

    expect(await screen.findByRole('heading', { name: 'Barsat Angkor Wat' })).toBeInTheDocument();
    expect(screen.getByText('Sunrise at the west gate')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open Photo 3' })).toBeInTheDocument();
    expect(getPath()).toBe('/albums/barsat-angkor-wat');
    // Guests get no curating or export controls.
    expect(screen.queryByRole('button', { name: /Add photos/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/admin'))).toBe(false);
  });

  it('shows "not found" for an unknown album', async () => {
    mockApi(() => ({ status: 404, data: { statusCode: 404, error: 'Not Found', message: 'Album not found' } }));
    renderApp('/albums/nope');
    expect(await screen.findByText('Album not found')).toBeInTheDocument();
  });

  it('lets an admin select photos on All and add them to an album', async () => {
    const calls = mockApi(({ method, url }) => {
      if (url === '/auth/me') return { status: 200, data: adminUser };
      if (url === '/admin/photos') return { status: 200, data: page(range(10, 1), null) };
      if (url === '/albums') return { status: 200, data: [angkor] };
      if (method === 'POST' && url === '/admin/albums/3/photos') return { status: 200, data: { changed: 2, album: { ...angkor, photoCount: 5 } } };
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/', { token: 'tok' });
    await user.click(await screen.findByRole('button', { name: 'Select' }));
    await user.click(await screen.findByRole('button', { name: 'Select Photo 10' }));
    await user.click(screen.getByRole('button', { name: 'Select Photo 8' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    // In select mode tapping a photo selects it rather than opening the viewer.
    expect(screen.queryByRole('dialog', { name: /Photo/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add to album/ }));
    const dialog = await screen.findByRole('dialog', { name: /Add 2 photos to an album/ });
    await user.click(await within(dialog).findByRole('button', { name: 'Add to Barsat Angkor Wat' }));
    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST' && c.url === '/admin/albums/3/photos');
      expect(JSON.parse(post!.data as string)).toEqual({ photoIds: [10, 8] });
    });
    expect(await within(dialog).findByRole('button', { name: 'Added to Barsat Angkor Wat' })).toBeInTheDocument();
  });

  it('exports an album as CSV and jumps to All in select mode from "Add photos"', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    const calls = mockApi(({ url }) => {
      if (url === '/auth/me') return { status: 200, data: adminUser };
      if (url === '/albums/barsat-angkor-wat') return { status: 200, data: angkor };
      if (url === '/albums/barsat-angkor-wat/photos') return { status: 200, data: page([3, 2, 1], null) };
      if (url === '/admin/photos') return { status: 200, data: page(range(10, 1), null) };
      if (url === '/admin/photos/export.csv') return { status: 200, data: new Blob(['id']) };
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/albums/barsat-angkor-wat', { token: 'tok' });
    await user.click(await screen.findByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(calls.find((c) => c.url === '/admin/photos/export.csv')?.params).toEqual({ status: 'all', album: 3 }));

    await user.click(screen.getByRole('button', { name: /Add photos/ }));
    await waitFor(() => expect(getPath()).toBe('/'));
    expect(await screen.findByRole('button', { name: 'Add to Barsat Angkor Wat' })).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: 'Select Photo 9' }));
    expect(screen.getByRole('button', { name: 'Add to Barsat Angkor Wat' })).toBeEnabled();
  });

  it('hides album management from a plain user', async () => {
    mockApi(({ url }) => {
      if (url === '/auth/me') return { status: 200, data: demoUser };
      if (url === '/photos') return { status: 200, data: page(range(10, 1), null) };
      if (url === '/albums') return { status: 200, data: [angkor] };
      return { status: 404 };
    });
    renderApp('/albums', { token: 'tok' });
    await screen.findByRole('link', { name: /Barsat Angkor Wat/ });
    expect(screen.queryByRole('button', { name: /New album/ })).not.toBeInTheDocument();
  });
});
