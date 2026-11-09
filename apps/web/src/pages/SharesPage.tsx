import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Empty, Result, Skeleton, Tag, Tooltip } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  LinkOutlined,
  LockOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { errorMessage } from '../api/client';
import { shareLinkUrl, useDeleteShare, useMyShares } from '../api/shares';
import type { Share } from '../api/types';
import { RequireAuth } from '../auth/RequireAuth';
import { assetUrl } from '../config';
import { copyText } from '../share/share';
import { ShareLinkModal } from '../components/ShareLinkModal';
import { audience } from './SharePage';

/** Links I made, links shared with me, and (admins) everyone else's. */
export function SharesPage() {
  return (
    <RequireAuth label="shared links">
      <SharesList />
    </RequireAuth>
  );
}

function SharesList() {
  const mine = useMyShares();
  const [editing, setEditing] = useState<Share | null>(null);

  if (mine.isPending) return <Skeleton active paragraph={{ rows: 6 }} className="share-list-skeleton" />;
  if (mine.isError) {
    return (
      <Result
        status="warning"
        title="Couldn't load your links"
        subTitle={errorMessage(mine.error, 'Please check your connection and try again.')}
        extra={
          <Button type="primary" icon={<ReloadOutlined aria-hidden />} onClick={() => mine.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  const { created, received, others } = mine.data;
  return (
    <div className="share-sections">
      <section aria-labelledby="shared-with-me">
        <h2 id="shared-with-me" className="share-section-title serif-title">
          Shared with me
        </h2>
        {received.length ? (
          <ShareRows shares={received} onEdit={setEditing} />
        ) : (
          <p className="share-empty">Nothing shared with you yet.</p>
        )}
      </section>
      <section aria-labelledby="my-links">
        <h2 id="my-links" className="share-section-title serif-title">
          My links
        </h2>
        {created.length ? (
          <ShareRows shares={created} onEdit={setEditing} />
        ) : (
          <Empty description="Select photos on any tab, then tap the link button to share them." />
        )}
      </section>
      {others && others.length > 0 && (
        <section aria-labelledby="others-links">
          <h2 id="others-links" className="share-section-title serif-title">
            Everyone else’s links
          </h2>
          <ShareRows shares={others} onEdit={setEditing} showOwner />
        </section>
      )}
      {editing && <ShareLinkModal share={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ShareRows({ shares, onEdit, showOwner }: { shares: Share[]; onEdit: (s: Share) => void; showOwner?: boolean }) {
  const { message, modal } = App.useApp();
  const del = useDeleteShare();
  const copy = async (s: Share) => message[(await copyText(shareLinkUrl(s))) ? 'success' : 'error']('Link copied');
  const remove = (s: Share) =>
    modal.confirm({
      title: 'Delete this link?',
      content: 'It stops working for everyone. The photos stay in the gallery.',
      okText: 'Delete link',
      okButtonProps: { danger: true },
      onOk: () =>
        del
          .mutateAsync(s)
          .then(() => message.success('Link deleted'))
          .catch((err) => message.error(errorMessage(err, "Couldn't delete the link"))),
    });

  return (
    <ul className="share-list">
      {shares.map((s) => {
        const n = s.photoCount;
        const name = s.title || `${n} photo${n === 1 ? '' : 's'}`;
        return (
          <li key={s.id} className={`share-row${s.expired ? ' is-expired' : ''}`}>
            <Link to={s.path} className="share-row-main">
              <span className="share-thumb">
                {s.cover ? (
                  <img src={assetUrl(s.cover.thumbUrl)} alt="" loading="lazy" decoding="async" />
                ) : (
                  <LinkOutlined aria-hidden />
                )}
              </span>
              <span className="share-row-text">
                <span className="share-row-title">{name}</span>
                <span className="share-row-sub">
                  {n} photo{n === 1 ? '' : 's'}
                  {(showOwner || !s.canManage) && ` · from ${s.createdBy.username}`} ·{' '}
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
                <span className="share-row-tags">
                  {s.canManage && (
                    <Tag bordered={false} icon={s.visibility === 'public' ? <GlobalOutlined /> : <LockOutlined />}>
                      {audience(s)}
                    </Tag>
                  )}
                  {s.expiresAt && (
                    <Tag bordered={false} color={s.expired ? 'red' : undefined}>
                      {s.expired ? 'Expired' : `Until ${new Date(s.expiresAt).toLocaleDateString()}`}
                    </Tag>
                  )}
                </span>
              </span>
            </Link>
            <span className="share-row-actions">
              <Tooltip title="Copy link">
                <Button type="text" icon={<CopyOutlined />} aria-label={`Copy link ${name}`} onClick={() => copy(s)} />
              </Tooltip>
              {s.canManage && (
                <>
                  <Tooltip title="Edit">
                    <Button type="text" icon={<EditOutlined />} aria-label={`Edit link ${name}`} onClick={() => onEdit(s)} />
                  </Tooltip>
                  <Tooltip title="Delete">
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`Delete link ${name}`}
                      onClick={() => remove(s)}
                    />
                  </Tooltip>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
