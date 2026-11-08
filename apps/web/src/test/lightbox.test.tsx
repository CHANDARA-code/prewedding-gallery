import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, mockIntersectionObserver, page, range, renderApp } from './utils';

describe('lightbox', () => {
  it('opens the full-size image and loads more when near the end', async () => {
    mockIntersectionObserver();
    const calls = mockApi(({ url, params }) =>
      url === '/photos'
        ? { status: 200, data: params.cursor ? page(range(4, 1), null) : page(range(10, 5), 'c1') }
        : { status: 404 },
    );
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Open Photo 7' }));
    await waitFor(() => expect(document.querySelector('img.ant-image-preview-img')).toHaveAttribute('src', '/uploads/7.jpg'));
    // Index 3 of 6 loaded is within 4 of the end, so the next page is requested.
    await waitFor(() => expect(calls.some((c) => c.params.cursor === 'c1')).toBe(true));
  });
});
