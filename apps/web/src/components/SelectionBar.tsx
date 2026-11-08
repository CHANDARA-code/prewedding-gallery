import { ReactNode, useEffect } from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { Photo } from '../api/types';
import type { Selection } from '../hooks/useSelection';

/** Floating bar shown in select mode: count, select-all / clear, the page's actions, and Done (Esc). */
export function SelectionBar({ selection, photos, children }: { selection: Selection; photos: Photo[]; children?: ReactNode }) {
  const n = selection.ids.size;
  const allLoaded = photos.length > 0 && photos.every((p) => selection.ids.has(p.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The photo viewer and modals handle their own Escape.
      if (e.key === 'Escape' && !document.querySelector('.viewer, .ant-modal-wrap')) selection.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected photos">
      <span className="selection-count" aria-live="polite">
        {n === 0 ? 'Tap photos to select' : `${n} selected`}
      </span>
      <Button size="small" type="link" onClick={() => (allLoaded ? selection.clear() : selection.add(photos.map((p) => p.id)))}>
        {allLoaded ? 'Clear' : `Select all ${photos.length} shown`}
      </Button>
      <span className="selection-actions">{children}</span>
      <Button icon={<CloseOutlined aria-hidden />} onClick={selection.stop} aria-label="Done selecting">
        Done
      </Button>
    </div>
  );
}
