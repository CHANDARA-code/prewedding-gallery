import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { adminUser, getPath, getSearch, makePhoto, mockApi, mockIntersectionObserver, page, range, renderApp } from './utils';

const viewerImg = () => document.querySelector('img.viewer-preview');

describe('photo viewer', () => {
  it('shows the clicked photo on the first open, then the next one, and loads more near the end', async () => {
    mockIntersectionObserver();
    const calls = mockApi(({ url, params }) => {
      if (url === '/photos') return { status: 200, data: params.cursor ? page(range(4, 1), null) : page(range(10, 5), 'c1') };
      const m = /^\/photos\/(\d+)$/.exec(url);
      if (m) return { status: 200, data: makePhoto(Number(m[1]), { mimeType: 'image/jpeg', sizeBytes: 2_000_000, exif: { make: 'Canon', model: 'Canon EOS R6', fNumber: 2.8, exposureTime: 0.00125, iso: 500 } }) };
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Open Photo 7' }));
    const dialog = await screen.findByRole('dialog');
    // The regression: the first open must show photo 7 itself (preview + its own thumbnail), never a previous photo.
    expect(viewerImg()).toHaveAttribute('src', '/uploads/previews/7.webp');
    expect(dialog.querySelector('.viewer-slide.is-current img.viewer-thumb')).toHaveAttribute('src', '/uploads/thumbs/7.webp');
    expect(getSearch()).toBe('?photo=7');

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(viewerImg()).toHaveAttribute('src', '/uploads/previews/6.webp'));
    expect(getSearch()).toBe('?photo=6');
    // Index 4 of 6 loaded is within 4 of the end, so the next page is requested.
    await waitFor(() => expect(calls.some((c) => c.params.cursor === 'c1')).toBe(true));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows EXIF details in the info panel', async () => {
    mockIntersectionObserver();
    mockApi(({ url }) =>
      url === '/photos'
        ? { status: 200, data: page([3], null) }
        : { status: 200, data: makePhoto(3, { mimeType: 'image/jpeg', sizeBytes: 2_000_000, exif: { make: 'Canon', model: 'Canon EOS R6', lens: 'RF 85mm', fNumber: 1.8, exposureTime: 0.004, iso: 200, focalLength: 85, takenAt: '2026-11-06T16:44:27+07:00' } }) },
    );
    const user = userEvent.setup();
    renderApp('/?photo=3');
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Photo details' }));
    const info = await screen.findByRole('complementary', { name: 'Photo details' });
    await within(info).findByText('Canon EOS R6');
    expect(within(info).getByText('f/1.8 · 1/250s · ISO 200 · 85 mm')).toBeInTheDocument();
    expect(within(info).getByText('6 Nov 2026, 16:44 (UTC+07:00)')).toBeInTheDocument();
    expect(within(info).getByText(/3000 × 2000 px · 6\.0 MP/)).toBeInTheDocument();
    expect(within(info).getByText('3:2 · Landscape')).toBeInTheDocument();
    expect(within(info).queryByText('Original name')).not.toBeInTheDocument(); // admin only
  });

  it('opens a shared /photo/:id link in the viewer even when it is not in the first page', async () => {
    mockIntersectionObserver();
    mockApi(({ url }) =>
      url === '/photos' ? { status: 200, data: page(range(10, 5), 'c1') } : url === '/photos/2' ? { status: 200, data: makePhoto(2, { title: 'Golden hour' }) } : { status: 404 },
    );
    renderApp('/photo/2');
    await waitFor(() => expect(viewerImg()).toHaveAttribute('src', '/uploads/previews/2.webp'));
    expect(getPath()).toBe('/');
    expect(getSearch()).toBe('?photo=2');
    expect(screen.getByRole('dialog')).toHaveTextContent('Golden hour');
  });

  it('lets an admin rotate a photo from the viewer and updates the grid', async () => {
    mockIntersectionObserver();
    const calls = mockApi(({ url, method }) => {
      if (url === '/auth/me') return { status: 200, data: adminUser };
      if (url === '/admin/photos') return { status: 200, data: page([5], null) };
      if (url === '/admin/photos/5/rotate' && method === 'POST')
        return { status: 200, data: makePhoto(5, { rotation: 90, width: 2000, height: 3000, thumbUrl: '/uploads/thumbs/5b.webp', previewUrl: '/uploads/previews/5b.webp' }) };
      if (url === '/photos/5') return { status: 200, data: makePhoto(5, { originalName: 'KSNT0990.jpg' }) };
      return { status: 404 };
    });
    const user = userEvent.setup();
    renderApp('/?photo=5', { token: 'admin-token' });
    await screen.findByRole('dialog');
    // Rotating lives in the viewer's ⋮ menu.
    await user.click(await screen.findByRole('button', { name: 'More options' }));
    await user.click(await screen.findByRole('menuitem', { name: /Rotate right/ }));
    await waitFor(() => expect(viewerImg()).toHaveAttribute('src', '/uploads/previews/5b.webp'));
    expect(calls.find((c) => c.url === '/admin/photos/5/rotate')?.data).toBe(JSON.stringify({ degrees: 90 }));
    await user.click(screen.getByRole('button', { name: 'Photo details' }));
    expect(await screen.findByText('KSNT0990.jpg')).toBeInTheDocument();
  });

  it('swiping left goes to the next photo', async () => {
    mockIntersectionObserver();
    mockApi(({ url }) => (url === '/photos' ? { status: 200, data: page([9, 8], null) } : { status: 200, data: makePhoto(Number(url.split('/').pop())) }));
    renderApp('/?photo=9');
    await screen.findByRole('dialog');
    await screen.findByRole('navigation', { name: 'Nearby photos' }); // list loaded, so there is a "next"
    const stage = document.querySelector('.viewer-stage')!;
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 200, pointerType: 'touch' });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 150, clientY: 205, pointerType: 'touch' });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 150, clientY: 205, pointerType: 'touch' });
    await waitFor(() => expect(viewerImg()).toHaveAttribute('src', '/uploads/previews/8.webp'));
  });
});
