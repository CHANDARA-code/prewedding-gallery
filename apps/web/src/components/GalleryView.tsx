import { ReactNode, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Divider, Empty, Result } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { flattenPages, usePhotoList } from '../api/photos';
import type { AdminStatus, Scope } from '../api/types';
import { errorMessage } from '../api/client';
import { useColumns } from '../hooks/useColumns';
import { supportsIntersectionObserver, useInfiniteSentinel } from '../hooks/useInfiniteSentinel';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { GridSkeleton, PhotoGrid } from './PhotoGrid';
import { PhotoViewer } from './PhotoViewer';

interface Props {
  scope: Scope;
  status?: AdminStatus;
  empty: ReactNode;
}

export function GalleryView({ scope, status, empty }: Props) {
  const columns = useColumns();
  const query = usePhotoList(scope, status);
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

  useScrollMemory(`${scope}:${status ?? ''}`, photos.length > 0);

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
        <PhotoGrid photos={photos} columns={columns} onOpen={openAt} />

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
};
