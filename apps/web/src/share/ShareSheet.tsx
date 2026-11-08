import { useState } from 'react';
import { App, Button, Input, Modal, Space, Typography } from 'antd';
import {
  CopyOutlined,
  DownloadOutlined,
  FacebookFilled,
  InstagramFilled,
  ShareAltOutlined,
  TelegramFilled,
  WhatsAppOutlined,
  XFilled,
} from '@ant-design/icons';
import type { Photo } from '../api/types';
import {
  copyText,
  isMobileDevice,
  photoAsJpegFile,
  saveFile,
  shareImageNatively,
  shareLink,
  ShareTarget,
  shareText,
  shareUrl,
} from './share';

function MessengerIcon() {
  return (
    <span className="anticon" aria-hidden>
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">
        <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.35.27.57l.05 1.78a.8.8 0 0 0 1.12.71l1.98-.88a.8.8 0 0 1 .53-.04c.91.25 1.87.38 2.91.38 5.64 0 10-4.13 10-9.7S17.64 2 12 2Zm6 7.46-2.94 4.66a1.5 1.5 0 0 1-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.94-4.66a1.5 1.5 0 0 1 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63Z" />
      </svg>
    </span>
  );
}

interface Props {
  photo: Photo | null;
  onClose: () => void;
}

const TARGETS: { key: ShareTarget | 'instagram'; label: string; icon: JSX.Element; color: string }[] = [
  { key: 'facebook', label: 'Facebook', icon: <FacebookFilled />, color: '#1877f2' },
  { key: 'messenger', label: 'Messenger', icon: <MessengerIcon />, color: '#a334fa' },
  { key: 'instagram', label: 'Instagram', icon: <InstagramFilled />, color: '#e1306c' },
  { key: 'telegram', label: 'Telegram', icon: <TelegramFilled />, color: '#229ed9' },
  { key: 'whatsapp', label: 'WhatsApp', icon: <WhatsAppOutlined />, color: '#25d366' },
  { key: 'x', label: 'X', icon: <XFilled />, color: '#111111' },
];

/** Share a photo link (rich preview via Open Graph) or the image itself (Instagram, native share). */
export function ShareSheet({ photo, onClose }: Props) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState<string | null>(null);
  if (!photo) return null;
  const url = shareUrl(photo.id);
  const text = shareText(photo);
  const mobile = isMobileDevice();

  const copy = async () => {
    if (await copyText(url)) message.success('Link copied');
    else message.error("Couldn't copy the link");
  };

  const open = (href: string) => window.open(href, '_blank', 'noopener,noreferrer,width=640,height=640');

  const onTarget = async (key: ShareTarget | 'instagram') => {
    if (key === 'instagram') {
      // Instagram has no web share link: share the image file (mobile) or save it for upload.
      setBusy(key);
      try {
        if (await shareImageNatively(photo)) return;
        saveFile(await photoAsJpegFile(photo), `prewedding-${photo.id}.jpg`);
        await copyText(url);
        message.info('Photo saved and link copied. Post it from the Instagram app.', 5);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') message.error("Couldn't prepare the photo for Instagram");
      } finally {
        setBusy(null);
      }
      return;
    }
    if (key === 'messenger' && !mobile) {
      // Messenger's web send dialog needs a Facebook app id; on desktop copy the link and open Messenger.
      await copyText(url);
      message.info('Link copied. Paste it into a Messenger chat.', 4);
      open('https://www.messenger.com/');
      return;
    }
    if (key === 'messenger') {
      window.location.href = shareLink('messenger', url, text);
      return;
    }
    open(shareLink(key, url, text));
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: photo.title ?? 'Pre-Wedding View', text, url });
    } catch {
      /* dismissed */
    }
  };

  return (
    <Modal open title="Share photo" footer={null} onCancel={onClose} width={440} className="share-sheet" destroyOnHidden>
      <div className="share-grid">
        {TARGETS.map((t) => (
          <button key={t.key} type="button" className="share-target" onClick={() => onTarget(t.key)} disabled={busy !== null}>
            <span className="share-icon" style={{ background: t.color }}>
              {t.icon}
            </span>
            <span>{busy === t.key ? 'Preparing…' : t.label}</span>
          </button>
        ))}
      </div>
      <Space.Compact style={{ width: '100%', marginTop: 16 }}>
        <Input readOnly value={url} aria-label="Photo link" onFocus={(e) => e.target.select()} />
        <Button icon={<CopyOutlined />} onClick={copy}>
          Copy
        </Button>
      </Space.Compact>
      <Space wrap style={{ marginTop: 12 }}>
        {typeof navigator.share === 'function' && (
          <Button icon={<ShareAltOutlined />} onClick={nativeShare}>
            More apps…
          </Button>
        )}
        <Button
          icon={<DownloadOutlined />}
          onClick={async () => {
            setBusy('download');
            try {
              saveFile(await photoAsJpegFile(photo), `prewedding-${photo.id}.jpg`);
            } catch {
              message.error("Couldn't download the photo");
            } finally {
              setBusy(null);
            }
          }}
          loading={busy === 'download'}
        >
          Save image
        </Button>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
        Links show a preview card with the photo in Facebook, Messenger, Telegram, WhatsApp and X.
      </Typography.Paragraph>
    </Modal>
  );
}
