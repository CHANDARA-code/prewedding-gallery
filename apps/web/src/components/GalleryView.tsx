import { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button, Divider, Empty, Result } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { flattenPages, usePhotoList } from '../api/photos';
import type { AdminStatus, Photo, Scope } from '../api/types';
import { errorMessage } from '../api/client';
import { useColumns } from '../hooks/useColumns';
import { supportsIntersectionObserver, useInfiniteSentinel } from '../hooks/useInfiniteSentinel';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { GridSkeleton, PhotoGrid } from './PhotoGrid';
import { PhotoViewer } from './PhotoViewer';
import { SelectionBar } from './SelectionBar';
import type { OpenModifiers } from './PhotoCard';
import type { DragPhase } from '../hooks/useDragSelect';
import type { Selection } from '../hooks/useSelection';

interface Props {
  scope: Scope;
  status?: AdminStatus;
  /** Album slug (scope 'album'). */
  album?: string;
  empty: ReactNode;
  /**
   * While `selection.active`, tapping a photo selects it (shift-click selects a range; Ctrl/Cmd+A selects all).
   * With a mouse, the hover check, Ctrl/⌘-click or dragging a box over the grid also start select mode.
   */
  selection?: Selection;
  /** Buttons for the selection bar, given the selected photos in grid order. */
  selectionActions?: (photos: Photo[]) => ReactNode;
}

export function GalleryView({ scope, status, album, empty, selection, selectionActions }: Props) {
  const columns = useColumns();
  const { message } = App.useApp();
  const query = usePhotoList(scope, status, true, album);
  const { data, isPending, isError, error, refetch, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } =
    query;
  const photos = useMemo(() => flattenPages(data), [data]);

  // The open photo lives in the URL (?photo=<id>): the back button closes the viewer, and links work.
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const viewerId = Number(params.get('photo')) || null;
  const pushedViewer = useRef(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMore = useCallback(() => fetchNextPage(), [fetchNextPage]);
  useInfiniteSentinel(sentinelRef, {
    hasNextPage: Boolean(hasNextPage),
    isFetchingNextPage,
    paused: isFetchNextPageError,
    fetchNextPage: loadMore,
  });
  const ioSupported = supportsIntersectionObserver();

  useScrollMemory(`${scope}:${status ?? album ?? ''}`, photos.length > 0);

  const setPhotoParam = useCallback(
    (id: number | null, replace: boolean) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === null) next.delete('photo');
          else next.set('photo', String(id));
          return next;
        },
        { replace, preventScrollReset: true },
      ),
    [setParams],
  );

  const openAt = useCallback(
    (index: number) => {
      const photo = photos[index];
      if (!photo) return;
      pushedViewer.current = true;
      setPhotoParam(photo.id, false);
    },
    [photos, setPhotoParam],
  );
  const showPhoto = useCallback((id: number) => setPhotoParam(id, true), [setPhotoParam]);
  const closeViewer = useCallback(() => {
    // Opened from the grid: go back (so Back/Forward stay natural). Opened from a link: drop the param.
    if (pushedViewer.current) navigate(-1);
    else setPhotoParam(null, true);
    pushedViewer.current = false;
  }, [navigate, setPhotoParam]);

  const selecting = Boolean(selection?.active);
  const anchor = useRef<number | null>(null);
  useEffect(() => {
    if (!selecting) anchor.current = null;
  }, [selecting]);
  const onCard = useCallback(
    (index: number, { shift, toggle }: OpenModifiers) => {
      if (!selection) return openAt(index);
      // Ctrl/⌘-click, shift-click or the hover check start select mode from a plain grid.
      if (!selection.active) {
        if (!shift && !toggle) return openAt(index);
        selection.start();
      }
      const photo = photos[index];
      if (!photo) return;
      if (shift && anchor.current !== null) {
        const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        selection.add(photos.slice(a, b + 1).map((p) => p.id));
      } else selection.toggle(photo.id);
      anchor.current = index;
    },
    [selection, photos, openAt],
  );

  // Drag a box with the mouse: what was selected before the drag stays, plus everything the box touches.
  const dragBase = useRef<{ ids: ReadonlySet<number>; wasActive: boolean } | null>(null);
  // Stable for the memoised grid: the handler itself changes with the URL (?photo=) and the list.
  const onCardRef = useRef(onCard);
  onCardRef.current = onCard;
  const onCardStable = useCallback((index: number, mods: OpenModifiers) => onCardRef.current(index, mods), []);

  const onDragSelect = useCallback(
    (ids: number[], phase: DragPhase) => {
      if (!selection) return;
      if (phase === 'start') {
        dragBase.current = { ids: selection.active ? selection.ids : new Set(), wasActive: selection.active };
        selection.start();
        return;
      }
      const base = dragBase.current;
      if (!base) return;
      if (phase === 'move') selection.set([...base.ids, ...ids]);
      if (phase === 'cancel') {
        if (base.wasActive) selection.set(base.ids);
        else selection.stop();
      }
      if (phase !== 'move') dragBase.current = null;
    },
    [selection],
  );

  // Ctrl+A / Cmd+A selects every loaded photo (and enters select mode), like a file manager.
  useEffect(() => {
    if (!selection || photos.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'a' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      if (document.querySelector('.viewer, .ant-modal-wrap')) return;
      e.preventDefault();
      selection.start();
      selection.add(photos.map((p) => p.id));
      const n = photos.length;
      message.info({
        key: 'select-all',
        content: `${n} photo${n === 1 ? '' : 's'} selected${hasNextPage ? ' (all loaded so far; scroll down to load more)' : ' (all)'}`,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, photos, hasNextPage, message]);

  const viewer = viewerId !== null && (
    <PhotoViewer
      photos={photos}
      photoId={viewerId}
      onNavigate={showPhoto}
      onClose={closeViewer}
      hasNextPage={Boolean(hasNextPage)}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={loadMore}
    />
  );

  // The viewer always renders at the same tree position, so it keeps its state while the list loads.
  return (
    <>
      {renderContent()}
      {viewer}
      {selection?.active && (
        <SelectionBar selection={selection} photos={photos}>
          {selectionActions?.(photos.filter((p) => selection.ids.has(p.id)))}
        </SelectionBar>
      )}
    </>
  );

  function renderContent() {
    if (isPending) return <GridSkeleton columns={columns} rows={4} />;

    // First-page failure (no photos to keep on screen).
    if (isError && photos.length === 0) {
      return (
        <Result
          status="warning"
          title="Couldn't load photos"
          subTitle={errorMessage(error, 'Please check your connection and try again.')}
          extra={
            <Button type="primary" icon={<ReloadOutlined aria-hidden />} onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      );
    }

    if (photos.length === 0) return <div className="center-state">{empty}</div>;

    return (
      <>
        <PhotoGrid
          photos={photos}
          columns={columns}
          onOpen={onCardStable}
          selected={selecting ? selection!.ids : undefined}
          onDragSelect={selection ? onDragSelect : undefined}
        />

        {isFetchingNextPage && <GridSkeleton columns={columns} rows={1} />}

        <div ref={sentinelRef} className="sentinel" aria-hidden />

        {isFetchNextPageError ? (
          <div className="list-footer">
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => fetchNextPage()}>
              Couldn't load more photos. Retry
            </Button>
          </div>
        ) : hasNextPage ? (
          <div className="list-footer">
            <Button
              className={ioSupported ? 'visually-hidden-focusable' : undefined}
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              Load more
            </Button>
          </div>
        ) : (
          <Divider plain className="end-divider">
            You've reached the end
          </Divider>
        )}
      </>
    );
  }
}

export const emptyStates = {
  all: <Empty description="No photos yet. Check back soon." />,
  favorite: <Empty description="No favorites yet. Tap the heart on any photo." />,
  save: <Empty description="Nothing saved yet. Tap the bookmark on any photo." />,
  trash: <Empty description="Trash is empty." />,
  album: <Empty description="No photos in this album yet." />,
};
