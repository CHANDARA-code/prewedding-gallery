import { useCallback, useMemo, useState } from 'react';

/** Multi-select over photo ids (select mode on any photo list). */
export interface Selection {
  active: boolean;
  ids: ReadonlySet<number>;
  start: () => void;
  /** Leaves select mode and clears the selection. */
  stop: () => void;
  toggle: (id: number) => void;
  add: (ids: number[]) => void;
  /** Replaces the whole selection (drag-to-select keeps it in step with the box). */
  set: (ids: Iterable<number>) => void;
  clear: () => void;
}

export function useSelection(initiallyActive = false): Selection {
  const [active, setActive] = useState(initiallyActive);
  const [ids, setIds] = useState<ReadonlySet<number>>(() => new Set());

  const start = useCallback(() => setActive(true), []);
  const clear = useCallback(() => setIds(new Set()), []);
  const stop = useCallback(() => {
    setActive(false);
    setIds(new Set());
  }, []);
  const toggle = useCallback(
    (id: number) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const add = useCallback((more: number[]) => setIds((prev) => new Set([...prev, ...more])), []);
  const set = useCallback((next: Iterable<number>) => setIds(new Set(next)), []);

  return useMemo(() => ({ active, ids, start, stop, toggle, add, set, clear }), [active, ids, start, stop, toggle, add, set, clear]);
}
