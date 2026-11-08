import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { Photo } from '../api/types';
import { useElementWidth } from '../hooks/useElementWidth';
import { PhotoCard } from './PhotoCard';

interface Props {
  photos: Photo[];
  columns: number;
  /** `shift`: shift-click (range select in select mode). */
  onOpen: (index: number, shift: boolean) => void;
  /** Select mode: cards toggle selection instead of opening the viewer. */
  selected?: ReadonlySet<number>;
}

const FALLBACK_ASPECT = 1.5;
const aspectOf = (p: Photo) => (p.width > 0 && p.height > 0 ? p.width / p.height : FALLBACK_ASPECT);

export interface RowLayout {
  start: number;
  photos: Photo[];
  height: number;
  widths: number[];
}

/**
 * Splits photos into rows of `columns` items and sizes each row so every card keeps its aspect ratio and
 * the row fills the container (a justified grid). Heights come only from stored width/height, so nothing
 * shifts when images load. A short final row is sized as if padded with average photos, so it isn't blown up.
 */
export function layoutRows(photos: Photo[], columns: number, width: number, gap: number): RowLayout[] {
  const rows: RowLayout[] = [];
  const inner = Math.max(0, width - gap * (columns - 1));
  for (let start = 0; start < photos.length; start += columns) {
    const rowPhotos = photos.slice(start, start + columns);
    const aspects = rowPhotos.map(aspectOf);
    const mean = aspects.reduce((a, b) => a + b, 0) / aspects.length;
    const sum = aspects.reduce((a, b) => a + b, 0) + (columns - rowPhotos.length) * Math.max(mean, 1);
    const height = Math.max(60, Math.floor(inner / sum));
    rows.push({ start, photos: rowPhotos, height, widths: aspects.map((a) => Math.floor(a * height)) });
  }
  return rows;
}

export function PhotoGrid({ photos, columns, onOpen, selected }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const gap = columns <= 2 ? 6 : 10;
  const rows = useMemo(() => layoutRows(photos, columns, width, gap), [photos, columns, width, gap]);

  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el) setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
  }, [width, columns]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.height ?? 200) + gap,
    overscan: 3,
    scrollMargin,
    getItemKey: (i) => rows[i]?.photos[0]?.id ?? i,
  });

  // Row sizes are pure functions of the layout; re-measure whenever it changes.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rows]);

  return (
    <div ref={containerRef} className="photo-grid" role="list" aria-label="Photos">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          return (
            <div
              key={v.key}
              className="photo-row"
              role="presentation"
              style={{ transform: `translateY(${v.start - scrollMargin}px)`, gap, height: row.height }}
            >
              {row.photos.map((photo, i) => (
                <div role="listitem" key={photo.id} style={{ width: row.widths[i], height: row.height }}>
                  <PhotoCard
                    photo={photo}
                    width={row.widths[i]}
                    height={row.height}
                    priority={v.index === 0}
                    onOpen={(shift) => onOpen(row.start + i, shift)}
                    selectMode={selected !== undefined}
                    selected={selected?.has(photo.id)}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GridSkeleton({ columns, rows = 3 }: { columns: number; rows?: number }) {
  return (
    <div className="skeleton-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }} aria-busy="true" aria-label="Loading photos">
      {Array.from({ length: columns * rows }, (_, i) => (
        <div key={i} className="skeleton-card" data-testid="skeleton-card" />
      ))}
    </div>
  );
}
