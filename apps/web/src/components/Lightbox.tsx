import { useEffect, useMemo } from 'react';
import { Image } from 'antd';
import type { Photo } from '../api/types';
import { assetUrl } from '../config';

interface Props {
  photos: Photo[];
  open: boolean;
  current: number;
  onChange: (index: number) => void;
  onClose: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

/**
 * Controlled `Image.PreviewGroup` over every loaded photo (the grid is virtualised, so most images are not
 * mounted). Loads the full-size `url`; fetches the next page when within 4 items of the end.
 */
export function Lightbox({ photos, open, current, onChange, onClose, hasNextPage, isFetchingNextPage, fetchNextPage }: Props) {
  const items = useMemo(
    () => photos.map((p) => ({ src: assetUrl(p.url), alt: p.caption || p.title || `Photo ${p.id}` })),
    [photos],
  );

  useEffect(() => {
    if (open && current >= items.length - 4 && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [open, current, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!items.length) return null;
  const photo = photos[current];

  return (
    <Image.PreviewGroup
      items={items}
      preview={{
        visible: open,
        current,
        onChange: (next) => onChange(next),
        onVisibleChange: (visible) => {
          if (!visible) onClose();
        },
        countRender: (c, total) => (
          <span className="lightbox-count">
            {photo?.title ? <strong>{photo.title} · </strong> : null}
            {c} / {total}
            {hasNextPage ? '+' : ''}
          </span>
        ),
      }}
    />
  );
}
