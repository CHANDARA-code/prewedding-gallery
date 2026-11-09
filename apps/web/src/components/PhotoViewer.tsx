import { PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState, WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import { App, Button, Dropdown, Result, Spin, Tooltip, type MenuProps } from 'antd';
import {
  ArrowLeftOutlined,
  BookFilled,
  BookOutlined,
  CaretRightOutlined,
  CloseOutlined,
  DownloadOutlined,
  FolderAddOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  HeartFilled,
  HeartOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  MoreOutlined,
  PauseOutlined,
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
import { useIsMobile } from '../hooks/useColumns';
import { ShareSheet } from '../share/ShareSheet';
import { formatTakenAt, PhotoInfo } from './PhotoInfo';
import { AlbumPickerModal } from './AlbumPickerModal';

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
/** Gap between photos while swiping, and how long a slide to the next one takes. */
const GAP = 24;
const SLIDE_ANIM_MS = 260;
/** Desktop: the controls fade out after the mouse rests this long. */
const IDLE_MS = 2600;
const INFO_KEY = 'pw_viewer_info';

const readInfoPref = () => {
  try {
    return localStorage.getItem(INFO_KEY) === '1';
  } catch {
    return false;
  }
};

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const canFullscreen = () => typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

/** "6 Nov 2026, 16:44" when the camera recorded it, else the upload day. */
function photoDate(p: Photo): string {
  const taken = formatTakenAt(p.exif?.takenAt);
  if (taken) return taken.replace(/ \(UTC.*\)$/, '');
  return new Date(p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

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

type Axis = 'x' | 'y' | null;

/**
 * Full-screen photo viewer, in the spirit of Google Photos: the photo fills the screen, the controls
 * float over it and get out of the way (mouse idle, or a tap on touch), photos slide like a carousel
 * under your finger, swipe up shows the details and swipe down closes.
 *
 * Each photo gets its own <img> elements (keyed by id + url), so the previous photo can never linger
 * on screen while the next one loads: the cached grid thumbnail shows instantly and the 2048px preview
 * fades in over it. Zooming past HD_SCALE swaps in the original.
 */
export function PhotoViewer({ photos, photoId, onNavigate, onClose, hasNextPage, isFetchingNextPage, fetchNextPage }: Props) {
  const { user, can, canManagePhotos, openLogin } = useAuth();
  const { message } = App.useApp();
  const mobile = useIsMobile();
  const index = photos.findIndex((p) => p.id === photoId);
  const listItem = index >= 0 ? photos[index] : undefined;
  const detail = usePhotoDetail(photoId, listItem);
  // List data carries the freshest favorite/save flags; detail adds EXIF, size and the original name.
  const photo: Photo | undefined = listItem ? { ...detail.data, ...listItem } : detail.data;
  const prev = index > 0 ? photos[index - 1] : undefined;
  const next = index >= 0 ? photos[index + 1] : undefined;

  const [view, setView] = useState<View>(RESET);
  const [hd, setHd] = useState(false);
  const [hdLoaded, setHdLoaded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(readInfoPref);
  const [chrome, setChrome] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stage = useElementSize(stageRef);

  const toggleFavorite = useToggle('favorite');
  const toggleSave = useToggle('save');
  const rotate = useRotate();

  // Previews that finished loading (here or as a neighbour), so a photo slid in is sharp at once.
  const loaded = useRef(new Set<string>());
  const [, bump] = useState(0);
  const markLoaded = useCallback((src: string) => {
    if (loaded.current.has(src)) return;
    loaded.current.add(src);
    bump((n) => n + 1);
  }, []);

  // Reset zoom/HD whenever the photo (or its rendering, after a rotation) changes.
  const renderKey = photo ? `${photo.id}:${viewUrl(photo)}` : '';
  useEffect(() => {
    setView(RESET);
    setHd(false);
    setHdLoaded(false);
  }, [renderKey]);

  // Fit a photo inside the stage (contain).
  const fit = useCallback(
    (p: Pick<Photo, 'width' | 'height'> | undefined) => {
      if (!p || !stage.width || !stage.height) return { w: 0, h: 0 };
      const f = Math.min(stage.width / p.width, stage.height / p.height);
      return { w: Math.round(p.width * f), h: Math.round(p.height * f) };
    },
    [stage.width, stage.height],
  );
  const base = useMemo(() => fit(photo), [fit, photo]);

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

  /* ---------- navigation: the strip of photos slides, then the next one takes over ---------- */
  const [slideX, setSlideX] = useState(0);
  const [noAnim, setNoAnim] = useState(false);
  const sliding = useRef<number | null>(null);

  const finishSlide = useCallback(
    (target: Photo) => {
      sliding.current = null;
      // Same frame: the new photo becomes current exactly where its neighbour copy was, with no animation.
      setNoAnim(true);
      setSlideX(0);
      onNavigate(target.id);
      requestAnimationFrame(() => requestAnimationFrame(() => setNoAnim(false)));
    },
    [onNavigate],
  );

  const go = useCallback(
    (dir: 1 | -1) => {
      if (sliding.current !== null) return;
      const target = dir === 1 ? next : prev;
      if (!target) {
        if (dir === 1 && hasNextPage && !isFetchingNextPage) fetchNextPage();
        setSlideX(0);
        return;
      }
      if (!stage.width || view.scale > 1 || reducedMotion()) {
        setSlideX(0);
        onNavigate(target.id);
        return;
      }
      setSlideX(-dir * (stage.width + GAP));
      sliding.current = window.setTimeout(() => finishSlide(target), SLIDE_ANIM_MS);
    },
    [next, prev, onNavigate, hasNextPage, isFetchingNextPage, fetchNextPage, stage.width, view.scale, finishSlide],
  );
  useEffect(() => () => window.clearTimeout(sliding.current ?? undefined), []);

  useEffect(() => {
    if (index >= 0 && index >= photos.length - 4 && hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [index, photos.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Warm the cache further ahead than the two neighbours that are already rendered.
  useEffect(() => {
    if (index < 0) return;
    for (const p of [photos[index + 2], photos[index - 2]]) {
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

  /* ---------- controls that get out of the way ---------- */
  const idle = useRef<number | undefined>(undefined);
  const overControls = useRef(false);
  const busyOverlay = shareOpen || albumsOpen || moreOpen;
  const wake = useCallback(() => {
    setChrome(true);
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      if (!overControls.current) setChrome(false);
    }, IDLE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(idle.current), []);
  // Never hide while a menu or dialog is up.
  useEffect(() => {
    if (busyOverlay) {
      window.clearTimeout(idle.current);
      setChrome(true);
    }
  }, [busyOverlay]);
  const controlsHover = {
    onMouseEnter: () => {
      overControls.current = true;
      setChrome(true);
    },
    onMouseLeave: () => {
      overControls.current = false;
    },
  };

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

  const setInfo = useCallback((open: boolean) => {
    setInfoOpen(open);
    try {
      localStorage.setItem(INFO_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);
  const toggleInfo = useCallback(() => setInfo(!infoOpen), [setInfo, infoOpen]);

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
      if (busyOverlay || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Tab') setChrome(true);
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
  }, [go, onClose, zoomAt, view.scale, toggleInfo, toggleFullscreen, download, busyOverlay]);

  /* ---------- pointer gestures: pan, pinch, swipe (left/right/up/down), double-tap ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; view: View; dist: number; moved: boolean; lastTap: number; axis: Axis; t: number }>({
    startX: 0,
    startY: 0,
    view: RESET,
    dist: 0,
    moved: false,
    lastTap: 0,
    axis: null,
    t: 0,
  });
  const [swipe, setSwipe] = useState({ x: 0, y: 0 });
  const [interacting, setInteracting] = useState(false);

  const centerOf = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { cx: clientX - r.left - r.width / 2, cy: clientY - r.top - r.height / 2 };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (sliding.current !== null) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setInteracting(true);
    const g = gesture.current;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.view = view;
    g.moved = false;
    g.axis = null;
    g.t = Date.now();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.dist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && !pointers.current.size) wake();
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
      if (view.scale > 1) {
        setView(clamp({ ...g.view, x: g.view.x + dx, y: g.view.y + dy }));
        return;
      }
      // Lock to one direction once the finger has clearly moved: sideways slides, vertical drags.
      if (!g.axis && Math.abs(dx) + Math.abs(dy) > 10) g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (g.axis === 'x') {
        // Resist at the ends, like a native carousel.
        const edge = (dx > 0 && !prev) || (dx < 0 && !next && !hasNextPage);
        setSwipe({ x: edge ? dx / 3 : dx, y: 0 });
      } else if (g.axis === 'y') {
        setSwipe({ x: 0, y: dy > 0 ? dy : dy / 3 });
      }
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
      g.axis = null;
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const fast = Date.now() - g.t < 250;
    setInteracting(false);
    if (view.scale === 1 && g.moved) {
      const horizontal = g.axis === 'x' || (!g.axis && Math.abs(dx) > Math.abs(dy));
      setSwipe({ x: 0, y: 0 });
      if (horizontal && (Math.abs(dx) > Math.min(120, stage.width * 0.2 || 60) || (fast && Math.abs(dx) > 30))) {
        const dir = dx < 0 ? 1 : -1;
        if ((dir === 1 && (next || hasNextPage)) || (dir === -1 && prev)) {
          // Carry on from where the finger let go.
          setSlideX(dx);
          requestAnimationFrame(() => go(dir));
          return;
        }
      } else if (!horizontal && dy < -70) {
        setInfo(true);
      } else if (!horizontal && dy > 110) {
        if (infoOpen && mobile) setInfo(false);
        else onClose();
      }
      return;
    }
    setSwipe({ x: 0, y: 0 });
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
  const previewLoaded = loaded.current.has(src);
  const busy = rotate.isPending;
  const dragY = view.scale === 1 ? swipe.y : 0;
  const closing = Math.max(0, dragY);
  const shrink = 1 - Math.min(0.25, closing / 900);
  const trackX = slideX + (view.scale === 1 ? swipe.x : 0);
  const showChrome = chrome && closing === 0;
  const live = photo && !photo.deletedAt;

  const iconBtn = (label: string, icon: ReactNode, onClick: () => void, opts: { tip?: string; on?: boolean; disabled?: boolean; loading?: boolean } = {}) => (
    <Tooltip title={opts.tip ?? label}>
      <Button
        type="text"
        className={`viewer-btn${opts.on ? ' is-on' : ''}`}
        aria-label={label}
        aria-pressed={opts.on === undefined ? undefined : opts.on}
        icon={icon}
        onClick={onClick}
        disabled={opts.disabled}
        loading={opts.loading}
      />
    </Tooltip>
  );

  const favBtn = live && iconBtn('Favorite', photo.isFavorite ? <HeartFilled /> : <HeartOutlined />, () => onToggle('favorite'), { tip: photo.isFavorite ? 'Remove from favorites' : 'Favorite', on: Boolean(photo.isFavorite) });
  const saveBtn = live && iconBtn('Save', photo.isSaved ? <BookFilled /> : <BookOutlined />, () => onToggle('save'), { tip: photo.isSaved ? 'Remove from saved' : 'Save', on: Boolean(photo.isSaved) });

  // Everything that isn't one tap away lives here; shortcuts are shown so they're discoverable.
  const moreItems: MenuProps['items'] = [
    { key: 'download', icon: <DownloadOutlined />, label: 'Download original', extra: 'D', disabled: !photo },
    { key: 'slideshow', icon: playing ? <PauseOutlined /> : <CaretRightOutlined />, label: playing ? 'Pause slideshow' : 'Slideshow', extra: 'Space', disabled: index < 0 },
    ...(canFullscreen() ? [{ key: 'fullscreen', icon: fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />, label: fullscreen ? 'Exit full screen' : 'Full screen', extra: 'F' }] : []),
    ...(live && can('albums.manage')
      ? [{ key: 'album', icon: <FolderAddOutlined />, label: 'Add to album…', disabled: photo.albums === undefined }]
      : []),
    ...(can('photos.edit') && photo
      ? [
          { type: 'divider' as const },
          { key: 'rotate-left', icon: <RotateLeftOutlined />, label: 'Rotate left', disabled: busy },
          { key: 'rotate-right', icon: <RotateRightOutlined />, label: 'Rotate right', disabled: busy },
        ]
      : []),
  ];
  const onMore: MenuProps['onClick'] = ({ key }) => {
    if (key === 'download') download();
    if (key === 'slideshow') setPlaying((p) => !p);
    if (key === 'fullscreen') toggleFullscreen();
    if (key === 'album') setAlbumsOpen(true);
    if (key === 'rotate-left') onRotate(-90);
    if (key === 'rotate-right') onRotate(90);
  };

  const neighbour = (p: Photo | undefined, dir: 1 | -1) => {
    if (!p) return null;
    const size = fit(p);
    const s = assetUrl(viewUrl(p));
    return (
      <div className="viewer-slide" style={{ transform: `translateX(${dir * (stage.width + GAP)}px)` }} aria-hidden>
        <div className="viewer-frame" style={{ width: size.w, height: size.h }}>
          <img className="viewer-img viewer-thumb" src={assetUrl(p.thumbUrl)} alt="" draggable={false} />
          <img
            className={`viewer-img viewer-neighbour${loaded.current.has(s) ? ' is-loaded' : ''}`}
            src={s}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => markLoaded(s)}
          />
        </div>
      </div>
    );
  };

  const body = (
    <div
      ref={rootRef}
      className={`viewer${showChrome ? '' : ' viewer-chrome-hidden'}${infoOpen ? ' viewer-info-open' : ''}${mobile ? ' is-mobile' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={photo ? `Photo ${photo.title ?? photo.id}` : 'Photo viewer'}
      onPointerMove={(e) => e.pointerType === 'mouse' && !pointers.current.size && wake()}
      onFocus={() => setChrome(true)}
    >
      <div className="viewer-backdrop" style={{ opacity: 1 - Math.min(0.7, closing / 350) }} />

      <div className="viewer-main">
        <div className="viewer-canvas">
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
                className="viewer-track"
                style={{ transform: `translateX(${trackX}px)`, transition: interacting || noAnim ? 'none' : undefined }}
              >
                {neighbour(prev, -1)}
                <div className="viewer-slide is-current">
                  <div
                    className="viewer-frame"
                    style={{
                      width: base.w,
                      height: base.h,
                      transform: `translate(${view.x}px, ${view.y + dragY}px) scale(${view.scale * shrink})`,
                      transition: interacting || noAnim ? 'none' : undefined,
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
                      onLoad={() => markLoaded(src)}
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
                </div>
                {neighbour(next, 1)}
              </div>
            )}
          </div>

          {photo && !previewLoaded && <Spin className="viewer-loading" aria-label="Loading photo" />}
          {hd && !hdLoaded && <span className="viewer-badge">Loading full resolution…</span>}
          {hd && hdLoaded && view.scale > 1 && <span className="viewer-badge">Original · {photo?.width}×{photo?.height}</span>}
          {playing && <span key={photoId} className="viewer-progress" style={{ animationDuration: `${SLIDE_MS}ms` }} aria-hidden />}

          {prev && (
            <button type="button" className="viewer-nav viewer-prev" aria-label="Previous photo" onClick={() => go(-1)} {...controlsHover}>
              <LeftOutlined />
            </button>
          )}
          {(next || hasNextPage) && index >= 0 && (
            <button type="button" className="viewer-nav viewer-next" aria-label="Next photo" onClick={() => go(1)} {...controlsHover}>
              {isFetchingNextPage && !next ? <Spin size="small" /> : <RightOutlined />}
            </button>
          )}

          <header className="viewer-bar" {...controlsHover}>
            <Tooltip title="Close (Esc)">
              <Button ref={closeRef} type="text" className="viewer-btn" aria-label="Close viewer" icon={<ArrowLeftOutlined />} onClick={onClose} />
            </Tooltip>
            <div className="viewer-title">
              {photo?.title && <span className="viewer-name">{photo.title}</span>}
              <span className="viewer-sub">
                {photo && <span>{photoDate(photo)}</span>}
                {index >= 0 && (
                  <span className="viewer-count">
                    {index + 1} of {total}
                    {hasNextPage ? '+' : ''}
                  </span>
                )}
              </span>
            </div>
            <div className="viewer-tools">
              {!mobile && (
                <>
                  {live && iconBtn('Share', <ShareAltOutlined />, () => setShareOpen(true), { tip: 'Share (S)' })}
                  <span className="viewer-zoom">
                    {iconBtn('Zoom out', <ZoomOutOutlined />, () => zoomAt(view.scale / 1.5), { tip: 'Zoom out (−)', disabled: view.scale <= 1 })}
                    <button type="button" className="viewer-zoom-label" onClick={() => setView(RESET)} title="Reset zoom (0)">
                      {Math.round(view.scale * 100)}%
                    </button>
                    {iconBtn('Zoom in', <ZoomInOutlined />, () => zoomAt(view.scale * 1.5), { tip: 'Zoom in (+)', disabled: view.scale >= MAX_SCALE })}
                  </span>
                </>
              )}
              {iconBtn('Photo details', <InfoCircleOutlined />, toggleInfo, { tip: 'Details (I)', on: infoOpen })}
              {!mobile && favBtn}
              {!mobile && saveBtn}
              <Dropdown trigger={['click']} placement="bottomRight" menu={{ items: moreItems, onClick: onMore }} onOpenChange={setMoreOpen} overlayClassName="viewer-menu">
                <Button type="text" className="viewer-btn" aria-label="More options" icon={<MoreOutlined />} loading={busy} />
              </Dropdown>
            </div>
          </header>

          <div className="viewer-bottom" {...controlsHover}>
            {strip.length > 1 && (
              <nav className="viewer-strip" ref={stripRef} aria-label="Nearby photos">
                {strip.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="viewer-strip-item"
                    aria-current={p.id === photoId}
                    aria-label={`Show ${p.title || `photo ${p.id}`}`}
                    onClick={() => onNavigate(p.id)}
                  >
                    <img src={assetUrl(p.thumbUrl)} alt="" loading="lazy" draggable={false} />
                  </button>
                ))}
              </nav>
            )}
            {mobile && (
              <nav className="viewer-actions" aria-label="Photo actions">
                <ActionButton label="Share" icon={<ShareAltOutlined />} onClick={() => setShareOpen(true)} disabled={!live} />
                <ActionButton
                  label="Favorite"
                  icon={photo?.isFavorite ? <HeartFilled /> : <HeartOutlined />}
                  on={Boolean(photo?.isFavorite)}
                  onClick={() => onToggle('favorite')}
                  disabled={!live}
                />
                <ActionButton label="Save" icon={photo?.isSaved ? <BookFilled /> : <BookOutlined />} on={Boolean(photo?.isSaved)} onClick={() => onToggle('save')} disabled={!live} />
                <ActionButton label="Download" icon={<DownloadOutlined />} onClick={download} disabled={!photo} />
                {live && can('albums.manage') && <ActionButton label="Album" icon={<FolderAddOutlined />} onClick={() => setAlbumsOpen(true)} disabled={photo.albums === undefined} />}
              </nav>
            )}
          </div>
        </div>

        {infoOpen && photo && (
          <aside className="viewer-info" role="complementary" aria-label="Photo details">
            <div className="viewer-info-head">
              {mobile && <button type="button" className="viewer-info-handle" aria-label="Hide details" onClick={() => setInfo(false)} />}
              <h2 className="viewer-info-title">Info</h2>
              <Button type="text" icon={<CloseOutlined />} aria-label="Close details" onClick={() => setInfo(false)} />
            </div>
            <PhotoInfo photo={photo} loading={detail.isFetching} isAdmin={canManagePhotos} />
          </aside>
        )}
      </div>

      {shareOpen && <ShareSheet photo={photo ?? null} onClose={() => setShareOpen(false)} />}
      {albumsOpen && photo && <AlbumPickerModal photoIds={[photo.id]} memberOf={photo.albums?.map((a) => a.id) ?? []} onClose={() => setAlbumsOpen(false)} />}
    </div>
  );

  return createPortal(body, document.body);
}

/** Bottom bar button on phones: icon over a label, like a native photo app. */
function ActionButton({ label, icon, onClick, on, disabled }: { label: string; icon: ReactNode; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`viewer-action${on ? ' is-on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on === undefined ? undefined : on}
      aria-label={label}
    >
      <span className="viewer-action-icon" aria-hidden>
        {icon}
      </span>
      <span className="viewer-action-label">{label}</span>
    </button>
  );
}
