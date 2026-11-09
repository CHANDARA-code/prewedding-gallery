import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { App, Button, Dropdown, Empty, Result, Skeleton, Tag } from 'antd';
import {
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  GlobalOutlined,
  LeftOutlined,
  LockOutlined,
  MoreOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { errorMessage } from '../api/client';
import { shareLinkUrl, useDeleteShare, useShare } from '../api/shares';
import type { Share } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useSelection } from '../hooks/useSelection';
import { copyText } from '../share/share';
import { GalleryView } from '../components/GalleryView';
import { GridSkeleton } from '../components/PhotoGrid';
import { SelectButton, SelectionActions } from '../components/PhotoSelectTools';
import { ShareLinkModal } from '../components/ShareLinkModal';

const photoCount = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;

/** Who a link is for, in words. */
export function audience(s: Share): string {
  if (s.visibility === 'public') return 'Anyone with the link';
  if (s.people?.length) return `Only ${s.people.map((u) => u.username).join(', ')}`;
  return 'Shared privately with you';
}

/** `/s/:token`: the photos someone shared, public or for chosen people. */
export function SharePage() {
  const { token = '' } = useParams();
  const { user, ready, openLogin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const share = useShare(token, user?.id ?? null, ready);
  const del = useDeleteShare();
  const selection = useSelection();
  const [editing, setEditing] = useState(false);

  if (!ready || share.isPending) {
    return (
      <>
        <div className="album-header">
          <Skeleton active title={{ width: 240 }} paragraph={{ rows: 1, width: 160 }} />
        </div>
        <GridSkeleton columns={3} rows={2} />
      </>
    );
  }
  if (share.isError) {
    const status = axios.isAxiosError(share.error) ? share.error.response?.status : undefined;
    if (status === 401) {
      return (
        <Result
          icon={<LockOutlined className="share-lock" />}
          title="Log in to see these photos"
          subTitle="They were shared with specific people."
          extra={
            <Button type="primary" size="large" onClick={() => openLogin(location.pathname)}>
              Log in
            </Button>
          }
        />
      );
    }
    const copy =
      status === 403
        ? {
            title: 'This link was shared with someone else',
            sub: `You're logged in as ${user?.username}. Ask the person who sent it to share it with you.`,
          }
        : status === 410
          ? { title: 'This link has expired', sub: 'Ask the person who sent it for a new one.' }
          : status === 404 || status === 400
            ? { title: 'Link not found', sub: 'It may have been deleted.' }
            : { title: "Couldn't open this link", sub: errorMessage(share.error, 'Please check your connection and try again.') };
    return (
      <Result
        status={status === 403 ? '403' : status === 404 || status === 410 || status === 400 ? '404' : 'warning'}
        title={copy.title}
        subTitle={copy.sub}
        extra={
          <Link to="/">
            <Button type="primary">See the gallery</Button>
          </Link>
        }
      />
    );
  }

  const s = share.data;
  const n = s.photoCount;
  const copyLink = async () => message[(await copyText(shareLinkUrl(s))) ? 'success' : 'error']('Link copied');
  const confirmDelete = () =>
    modal.confirm({
      title: 'Delete this link?',
      icon: <ExclamationCircleFilled />,
      content: 'It stops working for everyone. The photos stay in the gallery.',
      okText: 'Delete link',
      okButtonProps: { danger: true },
      onOk: () =>
        del
          .mutateAsync(s)
          .then(() => {
            message.success('Link deleted');
            navigate('/shares', { replace: true });
          })
          .catch((err) => message.error(errorMessage(err, "Couldn't delete the link"))),
    });

  return (
    <>
      <div className="album-header">
        {user && (
          <Link to="/shares" className="album-back">
            <LeftOutlined aria-hidden /> Shared links
          </Link>
        )}
        <h1 className="album-title serif-title">{s.title || `${photoCount(n)} shared with you`}</h1>
        <p className="album-description">Shared by {s.createdBy.username}</p>
        <p className="album-count share-meta">
          <span>
            <PictureOutlined aria-hidden /> {photoCount(n)}
          </span>
          {s.canManage && (
            <Tag bordered={false} icon={s.visibility === 'public' ? <GlobalOutlined /> : <LockOutlined />}>
              {audience(s)}
            </Tag>
          )}
          {s.expiresAt && (
            <Tag bordered={false} color={s.expired ? 'red' : undefined} icon={<ClockCircleOutlined />}>
              {s.expired ? 'Expired' : `Until ${new Date(s.expiresAt).toLocaleDateString()}`}
            </Tag>
          )}
        </p>
      </div>

      <div className="admin-filter">
        <Button icon={<CopyOutlined aria-hidden />} onClick={copyLink}>
          Copy link
        </Button>
        {!selection.active && n > 0 && <SelectButton selection={selection} />}
        {s.canManage && (
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'edit', icon: <EditOutlined />, label: 'Edit link…' },
                { type: 'divider' },
                { key: 'delete', icon: <DeleteOutlined />, label: 'Delete link', danger: true },
              ],
              onClick: ({ key }) => (key === 'edit' ? setEditing(true) : confirmDelete()),
            }}
          >
            <Button icon={<MoreOutlined />} aria-label="Link actions" />
          </Dropdown>
        )}
      </div>

      <GalleryView
        key={`${s.token}:${user?.id ?? ''}`}
        scope="share"
        album={s.token}
        empty={<Empty description="The photos in this link are no longer available." />}
        selection={selection}
        selectionActions={(selected) => <SelectionActions selected={selected} selection={selection} />}
      />

      {editing && <ShareLinkModal share={s} onClose={() => setEditing(false)} />}
    </>
  );
}
