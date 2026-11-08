import { existsSync, promises as fs } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

export const CARD_W = 1200;
export const CARD_H = 630;
const PAD = 28;

const escXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Renders the 1200x630 share card used as og:image: the photo blurred to fill the frame, the whole
 * photo on top (never cropped, so portraits look right), and a small site label. JPEG for the widest
 * crawler support (Facebook, Messenger, Telegram, X, LINE...).
 */
export async function renderShareCard(src: string, out: string, label: string): Promise<void> {
  const oriented = await sharp(src).autoOrient().toBuffer({ resolveWithObject: true });
  const background = await sharp(oriented.data)
    .resize(CARD_W, CARD_H, { fit: 'cover' })
    .blur(28)
    .modulate({ brightness: 0.72, saturation: 0.9 })
    .toBuffer();
  const photo = await sharp(oriented.data)
    .resize(CARD_W - PAD * 2, CARD_H - PAD * 2, { fit: 'inside' })
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((CARD_W - photo.info.width) / 2);
  const top = Math.round((CARD_H - photo.info.height) / 2);
  const text = escXml(label);
  const pillW = Math.min(CARD_W - 40, 26 + text.length * 11);
  const pill = Buffer.from(
    `<svg width="${pillW}" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" rx="20" fill="#000" fill-opacity="0.5"/>
      <text x="${pillW / 2}" y="26" font-family="Lato, DejaVu Sans, sans-serif" font-size="18" font-weight="600" fill="#fff" text-anchor="middle">${text}</text>
    </svg>`,
  );
  const tmp = `${out}.${process.pid}.tmp`;
  await sharp(background)
    .composite([
      { input: photo.data, left, top },
      { input: pill, left: CARD_W - pillW - 20, top: CARD_H - 60 },
    ])
    .jpeg({ quality: 84, mozjpeg: true, progressive: true })
    .toFile(tmp);
  await fs.rename(tmp, out); // atomic: a concurrent request never reads a half-written card
}

/** Returns the cached card path, rendering it on first use. `key` changes whenever the image does. */
export async function shareCardPath(cacheDir: string, key: string, src: string, label: string): Promise<string> {
  const out = join(cacheDir, `${key.replace(/[^\w.-]/g, '')}-card-v1.jpg`);
  if (!existsSync(out)) await renderShareCard(src, out, label);
  return out;
}
