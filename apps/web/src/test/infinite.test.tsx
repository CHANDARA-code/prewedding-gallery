import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, mockIntersectionObserver, page, range, renderApp } from './utils';

afterEach(() => vi.unstubAllGlobals());

describe('infinite scroll', () => {
  it('fetches the next page once, then shows the end-of-list message', async () => {
    const io = mockIntersectionObserver();
    const calls = mockApi(({ url, params }) => {
      if (url !== '/photos') return { status: 404 };
      if (!params.cursor) return { status: 200, data: page(range(48, 25), 'c1') };
      return { status: 200, data: page(range(24, 1), null) };
    });
    renderApp('/');
    await screen.findByRole('button', { name: 'Open Photo 48' });
    expect(screen.queryByText("You've reached the end")).not.toBeInTheDocument();

    act(() => {
      io.intersect();
      io.intersect(); // a second fire while the first is in flight must not double fetch
    });

    expect(await screen.findByText("You've reached the end")).toBeInTheDocument();
    const pageCalls = calls.filter((c) => c.url === '/photos');
    expect(pageCalls).toHaveLength(2);
    expect(pageCalls[1].params).toMatchObject({ cursor: 'c1', limit: 24 });

    // Nothing more to load: further intersections do nothing.
    act(() => io.intersect());
    expect(calls.filter((c) => c.url === '/photos')).toHaveLength(2);
  });

  it('shows a retry button on next-page failure without clearing loaded photos', async () => {
    const io = mockIntersectionObserver();
    let failNext = true;
    const calls = mockApi(({ url, params }) => {
      if (url !== '/photos') return { status: 404 };
      if (!params.cursor) return { status: 200, data: page(range(48, 25), 'c1') };
      if (failNext) return { status: 500, data: { statusCode: 500, error: 'Internal Server Error', message: 'boom' } };
      return { status: 200, data: page(range(24, 1), null) };
    });
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('button', { name: 'Open Photo 48' });

    act(() => io.intersect());
    const retry = await screen.findByRole('button', { name: "Couldn't load more photos. Retry" });
    expect(screen.getByRole('button', { name: 'Open Photo 48' })).toBeInTheDocument();

    // Paused while in error: the sentinel doesn't keep hammering the API.
    act(() => io.intersect());
    expect(calls.filter((c) => c.params.cursor === 'c1')).toHaveLength(1);

    failNext = false;
    await user.click(retry);
    expect(await screen.findByText("You've reached the end")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Photo 48' })).toBeInTheDocument();
  });

  it('renders a Load more fallback when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    mockApi(({ url, params }) =>
      url === '/photos'
        ? { status: 200, data: params.cursor ? page([1], null) : page(range(25, 2), 'c1') }
        : { status: 404 },
    );
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getByText("You've reached the end")).toBeInTheDocument());
  });

  it('virtualises rows: only rows near the viewport are mounted', async () => {
    mockIntersectionObserver();
    mockApi(({ url }) => (url === '/photos' ? { status: 200, data: page(range(60, 1), 'c1') } : { status: 404 }));
    renderApp('/');
    await screen.findByRole('button', { name: 'Open Photo 60' });
    const mounted = screen.getAllByTestId('photo-card').length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(60);
  });
});
