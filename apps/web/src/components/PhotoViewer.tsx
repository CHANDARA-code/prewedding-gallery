import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState, WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { App, Button, Result, Spin, Tooltip } from 'antd';
import {
  BookFilled,
  BookOutlined,
  CloseOutlined,
  DownloadOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  HeartFilled,
  HeartOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  PauseOutlined,
  CaretRightOutlined,
  RightOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  ShareAltOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import type { Photo } from '../api/types';
import { usePhotoDetail, useRotate, useToggle, viewUrl } from '../api/photos';
import { errorMessage } from '../api/client';
import { assetUrl } from '../config';
import { useAuth } from '../auth/AuthContext';
import { useElementSize } from '../hooks/useElementSize';
import { ShareSheet } from '../share/ShareSheet';
import { PhotoInfo } from './PhotoInfo';

interface Props {
  photos: Photo[];
  photoId: number;
  onNavigate: (id: number) => void;
  onClose: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

const MAX_SCALE = 8;
/** Above this zoom the 2048px preview gets soft, so the original is swapped in. */
const HD_SCALE = 1.6;
const SLIDE_MS = 4000;
const INFO_KEY = 'pw_viewer_info';

const readInfoPref = () => {
  try {
    return localStorage.getItem(INFO_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * The original file only has EXIF orientation applied by the browser, not the admin rotation, so the
 * full-resolution overlay is rotated with CSS (its box is the un-rotated size, centred in the frame).
 */
function originalStyle(rotation: number, frame: { w: number; h: number }): React.CSSProperties | undefined {
  if (!rotation) return undefined;
  const sideways = rotation === 90 || rotation === 270;
  return {
    width: sideways ? frame.h : frame.w,
    height: sideways ? frame.w : frame.h,
    left: '50%',
    top: '50%',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  };
}

interface View {
  scale: number;
  x: number;
  y: number;
}
const RESET: View = { scale: 1, x: 0, y: 0 };

/**
 * Full-screen photo viewer. Each photo gets its own <img> elements (keyed by id + url), so the
 * previous photo can never linger on screen while the next one loads: the cached grid thumbnail shows
 * instantly and the 2048px preview fades in over it. Zooming past HD_SCALE swaps in the original.
 */
export function PhotoViewer({ photos, photoId, onNavigate, onClose, hasNextPage, isFetchingNextPage, fetchNextPage }: Props) {
  const { user, can, canManagePhotos, openLogin } = useAuth();
  const { message } = App.useApp();
  const index = photos.findIndex((p) => p.id === photoId);
  const listItem = index >= 0 ? photos[index] : undefined;
  const detail = usePhotoDetail(photoId, listItem);
  // List data carries the freshest favorite/save flags; detail adds EXIF, size and the original name.
  const photo: Photo | undefined = listItem ? { ...detail.data, ...listItem } : detail.data;
  const prev = index > 0 ? photos[index - 1] : undefined;
  const next = index >= 0 ? photos[index + 1] : undefined;

  const [view, setView] = useState<View>(RESET);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [hd, setHd] = useState(false);
  const [hdLoaded, setHdLoaded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(readInfoPref);
  const [chrome, setChrome] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stage = useElementSize(stageRef);

  const toggleFavorite = useToggle('favorite');
  const toggleSave = useToggle('save');
  const rotate = useRotate();

  // Reset zoom/HD whenever the photo (or its rendering, after a rotation) changes.
  const renderKey = photo ? `${photo.id}:${viewUrl(photo)}` : '';
  useEffect(() => {
    setView(RESET);
    setHd(false);
    setHdLoaded(false);
  }, [renderKey]);

  // Fit the photo inside the stage (contain), never upscaling past the preview's real pixels much.
  const base = useMemo(() => {
    if (!photo || !stage.width || !stage.height) return { w: 0, h: 0 };
    const fit = Math.min(stage.width / photo.width, stage.height / photo.height);
    return { w: Math.round(photo.width * fit), h: Math.round(photo.height * fit) };
  }, [photo, stage.width, stage.height]);

  const clamp = useCallback(
    (v: View): View => {
      const scale = Math.min(MAX_SCALE, Math.max(1, v.scale));
      if (scale === 1) return RESET;
      const maxX = Math.max(0, (base.w * scale - stage.width) / 2);
      const maxY = Math.max(0, (base.h * scale - stage.height) / 2);
      return { scale, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
    },
    [base.w, base.h, stage.width, stage.height],
  );

  /** Zoom to `scale` keeping the point (cx, cy) — relative to the stage centre — fixed on screen. */
  const zoomAt = useCallback(
    (scale: number, cx = 0, cy = 0) =>
      setView((v) => {
        const s = Math.min(MAX_SCALE, Math.max(1, scale));
        return clamp({ scale: s, x: cx - ((cx - v.x) * s) / v.scale, y: cy - ((cy - v.y) * s) / v.scale });
      }),
    [clamp],
  );

  useEffect(() => {
    if (view.scale >= HD_SCALE && photo && photo.previewUrl && photo.previewUrl !== photo.url) setHd(true);
  }, [view.scale, photo]);

  /* ---------- navigation ---------- */
  const go = useCallback(
    (dir: 1 | -1) => {
      const target = dir === 1 ? next : prev;
      if (target) onNavigate(target.id);
      else if (dir === 1 && hasNextPage && !isFetchingNextPage) fetchNextPage();
    },
    [next, prev, onNavigate, hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    if (index >= 0 && index >= photos.length - 4 && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [index, photos.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Warm the cache for the neighbours so next/prev is instant.
  useEffect(() => {
    if (index < 0) return;
    for (const p of [photos[index + 1], photos[index - 1], photos[index + 2]]) {
      if (p) new Image().src = assetUrl(viewUrl(p));
    }
  }, [index, photos]);

  // Slideshow.
  useEffect(() => {
    if (!playing) return;
    if (!next && !hasNextPage) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => go(1), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [playing, photoId, next, hasNextPage, go]);

  // Keep the current filmstrip thumb in view.
  useEffect(() => {
    stripRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [photoId]);

  /* ---------- page integration: focus, scroll lock, fullscreen ---------- */
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void rootRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const toggleInfo = useCallback(() => {
    setInfoOpen((v) => {
      try {
        localStorage.setItem(INFO_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  }, []);

  /* ---------- actions ---------- */
  const onToggle = (kind: 'favorite' | 'save') => {
    if (!photo) return;
    if (!user) {
      openLogin();
      return;
    }
    const on = kind === 'favorite' ? !photo.isFavorite : !photo.isSaved;
    (kind === 'favorite' ? toggleFavorite : toggleSave).mutate(
      { photo, on },
      { onError: (err) => message.error(errorMessage(err, `Couldn't update ${kind}`)) },
    );
  };

  const onRotate = (degrees: 90 | -90) => {
    if (!photo) return;
    rotate.mutate(
      { id: photo.id, degrees },
      {
        onSuccess: (p) => message.success(`Rotated to ${p.rotation}° everywhere`),
        onError: (err) => message.error(errorMessage(err, "Couldn't rotate the photo")),
      },
    );
  };

  const download = useCallback(() => {
    if (!photo) return;
    const ext = photo.url.split('.').pop() ?? 'jpg';
    const a = Object.assign(document.createElement('a'), { href: assetUrl(photo.url), download: `prewedding-${photo.id}.${ext}` });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [photo]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shareOpen || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const keys: Record<string, () => void> = {
        ArrowRight: () => go(1),
        ArrowLeft: () => go(-1),
        Escape: () => (document.fullscreenElement ? undefined : onClose()),
        '+': () => zoomAt(view.scale * 1.5),
        '=': () => zoomAt(view.scale * 1.5),
        '-': () => zoomAt(view.scale / 1.5),
        '0': () => setView(RESET),
        i: toggleInfo,
        f: toggleFullscreen,
        ' ': () => setPlaying((p) => !p),
        d: download,
        s: () => setShareOpen(true),
      };
      const fn = keys[e.key] ?? keys[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose, zoomAt, view.scale, toggleInfo, toggleFullscreen, download, shareOpen]);

  /* ---------- pointer gestures: pan, pinch, swipe, double-tap ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; view: View; dist: number; moved: boolean; lastTap: number }>({
    startX: 0,
    startY: 0,
    view: RESET,
    dist: 0,
    moved: false,
    lastTap: 0,
  });
  const [swipe, setSwipe] = useState({ x: 0, y: 0 });
  const [interacting, setInteracting] = useState(false);

  const centerOf = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { cx: clientX - r.left - r.width / 2, cy: clientY - r.top - r.height / 2 };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setInteracting(true);
    const g = gesture.current;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.view = view;
    g.moved = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.dist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
    if (pointers.current.size === 2 && g.dist) {
      const [a, b] = [...pointers.current.values()];
      const { cx, cy } = centerOf((a.x + b.x) / 2, (a.y + b.y) / 2);
      const s = Math.min(MAX_SCALE, Math.max(1, (g.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      setView(clamp({ scale: s, x: cx - ((cx - g.view.x) * s) / g.view.scale, y: cy - ((cy - g.view.y) * s) / g.view.scale }));
    } else if (pointers.current.size === 1) {
      if (view.scale > 1) setView(clamp({ ...g.view, x: g.view.x + dx, y: g.view.y + dy }));
      else setSwipe({ x: dx, y: Math.max(0, dy) });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) {
      g.dist = 0; // finishing a pinch: don't treat the remaining finger as a swipe
      const [p] = [...pointers.current.values()];
      g.startX = p.x;
      g.startY = p.y;
      g.view = view;
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    setSwipe({ x: 0, y: 0 });
    setInteracting(false);
    if (view.scale === 1 && g.moved) {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      else if (dy > 110 && dy > Math.abs(dx)) onClose();
      return;
    }
    if (g.moved || e.type === 'pointercancel') return;
    // Tap: double-tap zooms (touch; mouse uses dblclick), single tap toggles the controls.
    const now = Date.now();
    if (e.pointerType !== 'mouse' && now - g.lastTap < 300) {
      const { cx, cy } = centerOf(e.clientX, e.clientY);
      if (view.scale > 1) setView(RESET);
      else zoomAt(2.5, cx, cy);
      g.lastTap = 0;
      return;
    }
    g.lastTap = now;
    if (e.pointerType !== 'mouse') setChrome((c) => !c);
  };

  const onWheel = (e: WheelEvent) => {
    const { cx, cy } = centerOf(e.clientX, e.clientY);
    zoomAt(view.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), cx, cy);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { cx, cy } = centerOf(e.clientX, e.clientY);
    if (view.scale > 1) setView(RESET);
    else zoomAt(2.5, cx, cy);
  };

  /* ---------- render ---------- */
  const total = photos.length;
  const strip = index >= 0 ? photos.slice(Math.max(0, index - 15), index + 16) : [];
  const src = photo ? assetUrl(viewUrl(photo)) : '';
  const previewLoaded = loadedSrc === src;
  const busy = rotate.isPending;

  const body = (
    <div
      ref={rootRef}
      className={`viewer${chrome ? '' : ' viewer-chrome-hidden'}${infoOpen ? ' viewer-info-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={photo ? `Photo ${photo.title ?? photo.id}` : 'Photo viewer'}
    >
      <div className="viewer-backdrop" style={{ opacity: 1 - Math.min(0.6, swipe.y / 400) }} />

      <header className="viewer-bar">
        <div className="viewer-title">
          {index >= 0 && (
            <span className="viewer-count">
              {index + 1} / {total}
              {hasNextPage ? '+' : ''}
            </span>
          )}
          {photo?.title && <span className="viewer-name">{photo.title}</span>}
        </div>
        <div className="viewer-tools">
          {photo && !photo.deletedAt && (
            <>
              <Tooltip title={photo.isFavorite ? 'Remove from favorites' : 'Favorite'}>
                <Button type="text" className={`viewer-btn${photo.isFavorite ? ' is-on' : ''}`} aria-pressed={Boolean(photo.isFavorite)} aria-label="Favorite" icon={photo.isFavorite ? <HeartFilled /> : <HeartOutlined />} onClick={() => onToggle('favorite')} />
              </Tooltip>
              <Tooltip title={photo.isSaved ? 'Remove from saved' : 'Save'}>
                <Button type="text" className={`viewer-btn${photo.isSaved ? ' is-on' : ''}`} aria-pressed={Boolean(photo.isSaved)} aria-label="Save" icon={photo.isSaved ? <BookFilled /> : <BookOutlined />} onClick={() => onToggle('save')} />
              </Tooltip>
              <Tooltip title="Share (S)">
                <Button type="text" className="viewer-btn" aria-label="Share" icon={<ShareAltOutlined />} onClick={() => setShareOpen(true)} />
              </Tooltip>
            </>
          )}
          <span className="viewer-desktop-only">
            <Tooltip title="Zoom out (−)">
              <Button type="text" className="viewer-btn" aria-label="Zoom out" icon={<ZoomOutOutlined />} disabled={view.scale <= 1} onClick={() => zoomAt(view.scale / 1.5)} />
            </Tooltip>
            <button type="button" className="viewer-zoom-label" onClick={() => setView(RESET)} title="Reset zoom (0)">
              {Math.round(view.scale * 100)}%
            </button>
            <Tooltip title="Zoom in (+)">
              <Button type="text" className="viewer-btn" aria-label="Zoom in" icon={<ZoomInOutlined />} disabled={view.scale >= MAX_SCALE} onClick={() => zoomAt(view.scale * 1.5)} />
            </Tooltip>
            <Tooltip title={playing ? 'Pause slideshow (Space)' : 'Slideshow (Space)'}>
              <Button type="text" className="viewer-btn" aria-label={playing ? 'Pause slideshow' : 'Play slideshow'} icon={playing ? <PauseOutlined /> : <CaretRightOutlined />} onClick={() => setPlaying((p) => !p)} disabled={index < 0} />
            </Tooltip>
            <Tooltip title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}>
              <Button type="text" className="viewer-btn" aria-label="Full screen" icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={toggleFullscreen} />
            </Tooltip>
          </span>
          <Tooltip title="Download original (D)">
            <Button type="text" className="viewer-btn" aria-label="Download original" icon={<DownloadOutlined />} onClick={download} disabled={!photo} />
          </Tooltip>
          {can('photos.edit') && photo && (
            <>
              <Tooltip title="Rotate left (admin, applies everywhere)">
                <Button type="text" className="viewer-btn" aria-label="Rotate left" icon={<RotateLeftOutlined />} onClick={() => onRotate(-90)} loading={busy} />
              </Tooltip>
              <Tooltip title="Rotate right (admin, applies everywhere)">
                <Button type="text" className="viewer-btn" aria-label="Rotate right" icon={<RotateRightOutlined />} onClick={() => onRotate(90)} disabled={busy} />
              </Tooltip>
            </>
          )}
          <Tooltip title="Details (I)">
            <Button type="text" className={`viewer-btn${infoOpen ? ' is-on' : ''}`} aria-pressed={infoOpen} aria-label="Photo details" icon={<InfoCircleOutlined />} onClick={toggleInfo} />
          </Tooltip>
          <Tooltip title="Close (Esc)">
            <Button ref={closeRef} type="text" className="viewer-btn" aria-label="Close viewer" icon={<CloseOutlined />} onClick={onClose} />
          </Tooltip>
        </div>
      </header>

      <div className="viewer-main">
        <div
          ref={stageRef}
          className={`viewer-stage${view.scale > 1 ? ' is-zoomed' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        >
          {!photo ? (
            detail.isError ? (
              <Result status="404" title="Photo not found" subTitle="It may have been removed." extra={<Button onClick={onClose}>Back to gallery</Button>} className="viewer-result" />
            ) : (
              <Spin size="large" />
            )
          ) : (
            <div
              className="viewer-frame"
              style={{
                width: base.w,
                height: base.h,
                transform: `translate(${view.x + swipe.x}px, ${view.y + swipe.y}px) scale(${view.scale})`,
                transition: interacting ? 'none' : undefined,
              }}
            >
              {/* Instant: the grid already cached this thumbnail. */}
              <img key={`t:${photo.id}:${photo.thumbUrl}`} className="viewer-img viewer-thumb" src={assetUrl(photo.thumbUrl)} alt="" aria-hidden draggable={false} />
              <img
                key={`p:${renderKey}`}
                className={`viewer-img viewer-preview${previewLoaded ? ' is-loaded' : ''}`}
                src={src}
                alt={photo.caption || photo.title || `Photo ${photo.id}`}
                draggable={false}
                decoding="async"
                onLoad={() => setLoadedSrc(src)}
              />
              {hd && (
                <img
                  key={`o:${photo.id}:${photo.url}:${photo.rotation ?? 0}`}
                  className={`viewer-img viewer-original${hdLoaded ? ' is-loaded' : ''}`}
                  style={originalStyle(photo.rotation ?? 0, base)}
                  src={assetUrl(photo.url)}
                  alt=""
                  aria-hidden
                  draggable={false}
                  decoding="async"
                  onLoad={() => setHdLoaded(true)}
                />
              )}
            </div>
          )}
          {photo && !previewLoaded && <Spin className="viewer-loading" aria-label="Loading photo" />}
          {hd && !hdLoaded && <span className="viewer-badge">Loading full resolution…</span>}
          {hd && hdLoaded && view.scale > 1 && <span className="viewer-badge">Original · {photo?.width}×{photo?.height}</span>}

          {prev && (
            <button type="button" className="viewer-nav viewer-prev" aria-label="Previous photo" onClick={() => go(-1)} onPointerDown={(e) => e.stopPropagation()}>
              <LeftOutlined />
            </button>
          )}
          {(next || hasNextPage) && index >= 0 && (
            <button type="button" className="viewer-nav viewer-next" aria-label="Next photo" onClick={() => go(1)} onPointerDown={(e) => e.stopPropagation()}>
              {isFetchingNextPage && !next ? <Spin size="small" /> : <RightOutlined />}
            </button>
          )}
        </div>

        {infoOpen && photo && (
          <aside className="viewer-info" role="complementary" aria-label="Photo details">
            <PhotoInfo photo={photo} loading={detail.isFetching} isAdmin={canManagePhotos} />
          </aside>
        )}
      </div>

      {strip.length > 1 && (
        <nav className="viewer-strip" ref={stripRef} aria-label="Nearby photos">
          {strip.map((p) => (
            <button key={p.id} type="button" className="viewer-strip-item" aria-current={p.id === photoId} aria-label={`Show ${p.title || `photo ${p.id}`}`} onClick={() => onNavigate(p.id)}>
              <img src={assetUrl(p.thumbUrl)} alt="" loading="lazy" draggable={false} />
            </button>
          ))}
        </nav>
      )}

      {shareOpen && <ShareSheet photo={photo ?? null} onClose={() => setShareOpen(false)} />}
    </div>
  );

  return createPortal(body, document.body);
}
