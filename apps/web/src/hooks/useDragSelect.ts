import { PointerEvent as ReactPointerEvent, RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { RowLayout } from '../components/PhotoGrid';

export type DragPhase = 'start' | 'move' | 'end' | 'cancel';
export interface DragBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pixels the mouse must travel before a press becomes a drag (so plain clicks stay clicks). */
const THRESHOLD = 8;
/** Auto-scroll when the pointer is this close to the top or bottom of the window. */
const EDGE = 64;

/**
 * Rubber-band selection over the justified grid with the mouse: press anywhere on the grid and drag, and
 * every photo the box touches is reported. Hits come from the row layout itself (not the DOM), so photos
 * in rows the virtualizer has unmounted while auto-scrolling are still counted.
 */
export function useDragSelect(
  containerRef: RefObject<HTMLElement | null>,
  rows: RowLayout[],
  gap: number,
  onDragSelect: ((ids: number[], phase: DragPhase) => void) | undefined,
) {
  const [box, setBox] = useState<DragBox | null>(null);
  const latest = useRef({ rows, gap, onDragSelect });
  latest.current = { rows, gap, onDragSelect };
  const drag = useRef<{ sx: number; sy: number; cx: number; cy: number; active: boolean; raf: number; cleanup: () => void } | null>(null);

  const hitTest = useCallback((b: DragBox): number[] => {
    const { rows: rs, gap: g } = latest.current;
    const hit: number[] = [];
    const right = b.left + b.width;
    const bottom = b.top + b.height;
    let y = 0;
    for (const row of rs) {
      const rowBottom = y + row.height;
      if (y > bottom) break;
      if (rowBottom >= b.top) {
        let x = 0;
        row.photos.forEach((p, i) => {
          const w = row.widths[i];
          if (x <= right && x + w >= b.left) hit.push(p.id);
          x += w + g;
        });
      }
      y = rowBottom + g;
    }
    return hit;
  }, []);

  const update = useCallback(() => {
    const d = drag.current;
    const el = containerRef.current;
    if (!d || !d.active || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(d.cx - r.left, 0), r.width);
    const y = Math.min(Math.max(d.cy - r.top, 0), r.height);
    const b = { left: Math.min(d.sx, x), top: Math.min(d.sy, y), width: Math.abs(x - d.sx), height: Math.abs(y - d.sy) };
    setBox(b);
    latest.current.onDragSelect?.(hitTest(b), 'move');
  }, [containerRef, hitTest]);

  const finish = useCallback((phase: 'end' | 'cancel') => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.cleanup();
    if (!d.active) return;
    setBox(null);
    document.body.classList.remove('is-drag-selecting');
    latest.current.onDragSelect?.([], phase);
    if (phase === 'end') {
      // The mouseup after a drag also fires a click on whatever photo it ended over: swallow it.
      const swallow = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300);
    }
  }, []);

  useEffect(() => () => finish('cancel'), [finish]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!latest.current.onDragSelect || e.pointerType !== 'mouse' || e.button !== 0 || drag.current) return;
      const t = e.target as HTMLElement;
      // Buttons on a card (favorite, save, admin menu, the hover check) keep working normally.
      if (t.closest('.card-actions, .card-admin, .select-hover, input, textarea, a')) return;
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = { sx: e.clientX - r.left, sy: e.clientY - r.top, cx: e.clientX, cy: e.clientY, active: false, raf: 0, cleanup: () => {} };

      const scrollLoop = () => {
        const cur = drag.current;
        if (!cur?.active) return;
        const speed = cur.cy < EDGE ? -(EDGE - cur.cy) / 2 : cur.cy > window.innerHeight - EDGE ? (cur.cy - (window.innerHeight - EDGE)) / 2 : 0;
        if (speed) {
          window.scrollBy(0, speed);
          update();
        }
        cur.raf = requestAnimationFrame(scrollLoop);
      };
      const onMove = (ev: PointerEvent) => {
        d.cx = ev.clientX;
        d.cy = ev.clientY;
        if (!d.active) {
          const r2 = el.getBoundingClientRect();
          if (Math.hypot(ev.clientX - r2.left - d.sx, ev.clientY - r2.top - d.sy) < THRESHOLD) return;
          d.active = true;
          document.body.classList.add('is-drag-selecting');
          window.getSelection?.()?.removeAllRanges();
          latest.current.onDragSelect?.([], 'start');
          d.raf = requestAnimationFrame(scrollLoop);
        }
        ev.preventDefault();
        update();
      };
      const onUp = () => finish('end');
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape' && d.active) {
          ev.preventDefault();
          ev.stopPropagation();
          finish('cancel');
        }
      };
      const onScroll = () => update();
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, { passive: true });
      d.cleanup = () => {
        cancelAnimationFrame(d.raf);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll);
      };
      drag.current = d;
    },
    [containerRef, update, finish],
  );

  return { box, onPointerDown };
}
