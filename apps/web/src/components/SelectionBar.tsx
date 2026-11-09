import { ReactNode, useEffect } from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { Photo } from '../api/types';
import type { Selection } from '../hooks/useSelection';

/** Floating bar shown in select mode: count, select-all / clear, the page's actions, and Done (Esc). */
export function SelectionBar({ selection, photos, children }: { selection: Selection; photos: Photo[]; children?: ReactNode }) {
  const n = selection.ids.size;
  const allLoaded = photos.length > 0 && photos.every((p) => selection.ids.has(p.id));
  const mouse = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

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
        {n === 0 ? (mouse ? 'Click photos or drag across them' : 'Tap photos to select') : `${n} photo${n === 1 ? '' : 's'} selected`}
      </span>
      <Button
        size="small"
        type="link"
        title={allLoaded ? undefined : `Select all (${/Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+'}A)`}
        onClick={() => (allLoaded ? selection.clear() : selection.add(photos.map((p) => p.id)))}
      >
        {allLoaded ? 'Clear' : `Select all ${photos.length} shown`}
      </Button>
      <span className="selection-actions">{children}</span>
      <Button icon={<CloseOutlined aria-hidden />} onClick={selection.stop} aria-label="Done selecting">
        Done
      </Button>
    </div>
  );
}
