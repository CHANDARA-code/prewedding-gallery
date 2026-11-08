import { App, Button, Descriptions, Skeleton, Tooltip, Typography } from 'antd';
import { CopyOutlined, ExportOutlined, FolderOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import type { Photo, PhotoExif } from '../api/types';
import { assetUrl } from '../config';
import { copyText, shareUrl } from '../share/share';

const RATIOS: [number, string][] = [
  [1, '1:1'], [5 / 4, '5:4'], [4 / 3, '4:3'], [3 / 2, '3:2'], [16 / 10, '16:10'], [16 / 9, '16:9'], [2, '2:1'], [21 / 9, '21:9'],
];

export function aspectLabel(w: number, h: number): string {
  if (!w || !h) return '—';
  const r = Math.max(w, h) / Math.min(w, h);
  const hit = RATIOS.find(([v]) => Math.abs(v - r) / v < 0.012);
  if (!hit) return `${(w / h).toFixed(2)}:1`;
  const [a, b] = hit[1].split(':');
  return w >= h ? `${a}:${b}` : `${b}:${a}`;
}

export const formatBytes = (n?: number) =>
  n === undefined ? '—' : n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;

export const formatShutter = (t?: number) => (!t ? undefined : t >= 1 ? `${t}s` : `1/${Math.round(1 / t)}s`);

/** Camera wall-clock time as shot ("6 Nov 2026, 16:44 (UTC+07:00)"), not converted to the viewer's zone. */
export function formatTakenAt(s?: string): string | undefined {
  const m = s && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(.*)$/.exec(s);
  if (!m) return undefined;
  const month = new Date(Date.UTC(2000, Number(m[2]) - 1, 1)).toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  return `${Number(m[3])} ${month} ${m[1]}, ${m[4]}:${m[5]}${m[6] ? ` (UTC${m[6]})` : ''}`;
}

export function cameraName(x?: PhotoExif | null) {
  if (!x?.model && !x?.make) return undefined;
  if (x.make && x.model?.toLowerCase().startsWith(x.make.toLowerCase())) return x.model;
  return [x.make, x.model].filter(Boolean).join(' ');
}

export function exposureLine(x?: PhotoExif | null) {
  if (!x) return undefined;
  const parts = [
    x.fNumber ? `f/${x.fNumber}` : null,
    formatShutter(x.exposureTime),
    x.iso ? `ISO ${x.iso}` : null,
    x.focalLength ? `${Math.round(x.focalLength)} mm` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

interface Props {
  photo: Photo;
  loading: boolean;
  isAdmin: boolean;
}

/** Everything known about a photo, for the viewer's info panel. */
export function PhotoInfo({ photo, loading, isAdmin }: Props) {
  const { message } = App.useApp();
  const x = photo.exif;
  const mp = (photo.width * photo.height) / 1e6;
  const copy = async (text: string, what: string) => message[(await copyText(text)) ? 'success' : 'error'](`${what} copied`);
  const type = photo.mimeType?.split('/')[1]?.toUpperCase();
  const orientation = photo.width === photo.height ? 'Square' : photo.width > photo.height ? 'Landscape' : 'Portrait';

  const items = [
    { key: 'dims', label: 'Dimensions', children: `${photo.width} × ${photo.height} px · ${mp.toFixed(1)} MP` },
    { key: 'aspect', label: 'Aspect', children: `${aspectLabel(photo.width, photo.height)} · ${orientation}` },
    { key: 'file', label: 'File', children: type ? `${type} · ${formatBytes(photo.sizeBytes)}` : loading ? <Skeleton.Input size="small" active /> : '—' },
    cameraName(x) && { key: 'camera', label: 'Camera', children: cameraName(x) },
    x?.lens && { key: 'lens', label: 'Lens', children: x.lens },
    exposureLine(x) && { key: 'exposure', label: 'Exposure', children: exposureLine(x) },
    x?.exposureBias ? { key: 'ev', label: 'Exp. bias', children: `${x.exposureBias > 0 ? '+' : ''}${x.exposureBias.toFixed(1)} EV` } : null,
    x?.flash !== undefined && { key: 'flash', label: 'Flash', children: x.flash ? 'Fired' : 'Off' },
    formatTakenAt(x?.takenAt) && { key: 'taken', label: 'Taken', children: formatTakenAt(x?.takenAt) },
    photo.albums?.length
      ? {
          key: 'albums',
          label: photo.albums.length === 1 ? 'Album' : 'Albums',
          children: (
            <span className="info-albums">
              {photo.albums.map((a) => (
                <Link key={a.id} to={`/albums/${a.slug}`} className="info-album-link">
                  <FolderOutlined aria-hidden /> {a.name}
                </Link>
              ))}
            </span>
          ),
        }
      : null,
    { key: 'uploaded', label: 'Added', children: new Date(photo.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) },
    isAdmin && {
      key: 'original',
      label: 'Original name',
      children: photo.originalName ? (
        <span className="info-copyable">
          <Typography.Text code>{photo.originalName}</Typography.Text>
          <Tooltip title="Copy file name">
            <Button size="small" type="text" icon={<CopyOutlined />} aria-label="Copy original file name" onClick={() => copy(photo.originalName!, 'File name')} />
          </Tooltip>
        </span>
      ) : loading ? (
        <Skeleton.Input size="small" active />
      ) : (
        '—'
      ),
    },
    isAdmin && { key: 'id', label: 'Photo ID', children: `#${photo.id}${photo.rotation ? ` · rotated ${photo.rotation}°` : ''}` },
  ].filter(Boolean) as { key: string; label: string; children: React.ReactNode }[];

  return (
    <div className="photo-info">
      {photo.title && <h2 className="photo-info-title serif-title">{photo.title}</h2>}
      {photo.caption && <p className="photo-info-caption">{photo.caption}</p>}
      <Descriptions column={1} size="small" items={items} className="photo-info-list" />
      {!x && !loading && <p className="photo-info-note">No camera data in this file.</p>}
      <div className="photo-info-actions">
        <Button icon={<ExportOutlined />} href={assetUrl(photo.url)} target="_blank" rel="noopener">
          Open original
        </Button>
        <Button icon={<CopyOutlined />} onClick={() => copy(shareUrl(photo.id), 'Link')}>
          Copy link
        </Button>
      </div>
    </div>
  );
}
