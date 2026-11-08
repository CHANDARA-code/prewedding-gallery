import type { Photo } from '../api/types';
import { viewUrl } from '../api/photos';
import { assetUrl } from '../config';

/** Public link for a photo. The server renders Open Graph tags for it, so apps show a preview card. */
export const shareUrl = (id: number) => `${window.location.origin}/photo/${id}`;

export const shareText = (p: Pick<Photo, 'id' | 'title' | 'caption'>) =>
  p.title ? `${p.title}${p.caption ? ` — ${p.caption}` : ''}` : p.caption || 'A photo from our pre-wedding gallery 💍';

export const isMobileDevice = () =>
  typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)));

export type ShareTarget = 'facebook' | 'messenger' | 'telegram' | 'whatsapp' | 'x';

/** Web share endpoints that need nothing but the link (the preview comes from the page's OG tags). */
export function shareLink(target: ShareTarget, url: string, text: string): string {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  switch (target) {
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case 'messenger':
      // The app deep link works without a Facebook app id; desktop falls back in ShareSheet.
      return `fb-messenger://share/?link=${u}`;
    case 'telegram':
      return `https://t.me/share/url?url=${u}&text=${t}`;
    case 'whatsapp':
      return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
    case 'x':
      return `https://twitter.com/intent/tweet?url=${u}&text=${t}`;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  }
}

/**
 * The photo as a JPEG File (Instagram and some share targets reject WebP). Converts the 2048px preview
 * in a canvas, so it's light and already correctly rotated.
 */
export async function photoAsJpegFile(photo: Photo): Promise<File> {
  const res = await fetch(assetUrl(viewUrl(photo)));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const name = `prewedding-${photo.id}.jpg`;
  if (blob.type === 'image/jpeg') return new File([blob], name, { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.92),
  );
  return new File([jpeg], name, { type: 'image/jpeg' });
}

export function saveFile(file: Blob, name: string) {
  const href = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Native share sheet with the image attached (mobile). Returns false when unsupported. */
export async function shareImageNatively(photo: Photo): Promise<boolean> {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  const file = await photoAsJpegFile(photo);
  if (!navigator.canShare({ files: [file] })) return false;
  await navigator.share({ files: [file], title: photo.title ?? 'Pre-Wedding View', text: `${shareText(photo)}\n${shareUrl(photo.id)}` });
  return true;
}
