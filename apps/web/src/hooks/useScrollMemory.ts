import { useEffect, useRef } from 'react';

const offsets = new Map<string, number>();

/**
 * Saves the window scroll offset for `key` when the view unmounts and restores it with
 * `window.scrollTo` once the view has content again (spec 7.7).
 */
export function useScrollMemory(key: string, hasContent: boolean) {
  const current = useRef(0);
  const restored = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      current.current = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      offsets.set(key, current.current);
    };
  }, [key]);

  useEffect(() => {
    if (restored.current || !hasContent) return;
    restored.current = true;
    const y = offsets.get(key) ?? 0;
    current.current = y;
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }));
  }, [key, hasContent]);
}
