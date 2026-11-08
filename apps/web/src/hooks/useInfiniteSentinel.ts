import { RefObject, useEffect, useRef } from 'react';

interface Options {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** When set (e.g. the last next-page request failed) the sentinel stays idle until the user retries. */
  paused?: boolean;
  fetchNextPage: () => unknown;
  rootMargin?: string;
}

export const supportsIntersectionObserver = () =>
  typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function';

/**
 * Watches a sentinel element after the grid and loads the next page before the user reaches the end.
 * Calls `fetchNextPage()` only when `hasNextPage && !isFetchingNextPage`, so it never double fires.
 */
export function useInfiniteSentinel(
  ref: RefObject<Element | null>,
  { hasNextPage, isFetchingNextPage, paused = false, fetchNextPage, rootMargin = '800px 0px' }: Options,
) {
  const latest = useRef({ hasNextPage, isFetchingNextPage, paused, fetchNextPage });
  latest.current = { hasNextPage, isFetchingNextPage, paused, fetchNextPage };

  const armed = hasNextPage && !isFetchingNextPage && !paused;

  useEffect(() => {
    const el = ref.current;
    if (!el || !armed || !supportsIntersectionObserver()) return;
    // Re-created whenever it re-arms, so a sentinel that is still in view after a page lands fires again.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        const s = latest.current;
        if (s.hasNextPage && !s.isFetchingNextPage && !s.paused) {
          s.isFetchingNextPage = true; // guard until React re-renders with the real state
          s.fetchNextPage();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, armed, rootMargin]);
}
