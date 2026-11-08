import { memo, MouseEvent, useState } from 'react';
import { App, Button, Dropdown, Form, Input, Modal, Popconfirm, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  BookFilled,
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  HeartFilled,
  HeartOutlined,
  MoreOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import type { Photo } from '../api/types';
import { useHardDelete, useRestore, useSoftDelete, useToggle, useUpdatePhoto } from '../api/photos';
import { errorMessage } from '../api/client';
import { assetUrl } from '../config';
import { useAuth } from '../auth/AuthContext';

interface Props {
  photo: Photo;
  width: number;
  height: number;
  /** First row: load eagerly with high fetch priority instead of lazy. */
  priority?: boolean;
  onOpen: () => void;
}

const stop = (e: MouseEvent) => e.stopPropagation();

function PhotoCardInner({ photo, width, height, priority, onOpen }: Props) {
  const { user, isAdmin, openLogin } = useAuth();
  const { message } = App.useApp();
  const toggleFavorite = useToggle('favorite');
  const toggleSave = useToggle('save');
  const [failed, setFailed] = useState(false);
  const deleted = Boolean(photo.deletedAt);
  const label = photo.title || `Photo ${photo.id}`;

  const onToggle = (kind: 'favorite' | 'save') => (e: MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      openLogin();
      return;
    }
    const m = kind === 'favorite' ? toggleFavorite : toggleSave;
    const on = kind === 'favorite' ? !photo.isFavorite : !photo.isSaved;
    m.mutate(
      { photo, on },
      { onError: (err) => message.error(errorMessage(err, `Couldn't update ${kind === 'favorite' ? 'favorite' : 'save'}`)) },
    );
  };

  const imgPriority = priority
    ? ({ fetchpriority: 'high' } as Record<string, string>)
    : ({ loading: 'lazy' } as const);

  return (
    <div
      className={`photo-card${deleted ? ' is-deleted' : ''}`}
      style={{ width, height }}
      data-testid="photo-card"
    >
      <button type="button" className="photo-open" onClick={onOpen} aria-label={`Open ${label}`}>
        {failed ? (
          <span className="photo-fallback" aria-hidden>
            ♡
          </span>
        ) : (
          <img
            src={assetUrl(photo.thumbUrl)}
            alt={photo.caption || label}
            width={photo.width}
            height={photo.height}
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            {...imgPriority}
          />
        )}
      </button>

      {deleted && (
        <Tag color="default" className="deleted-tag">
          Deleted
        </Tag>
      )}

      {photo.title && <div className="photo-title">{photo.title}</div>}

      <div className="card-actions" onClick={stop}>
        {!deleted && (
          <>
            <Tooltip title={photo.isFavorite ? 'Remove from favorites' : 'Favorite'} mouseEnterDelay={0.6}>
              <Button
                shape="circle"
                className={`action-btn${photo.isFavorite ? ' is-on' : ''}`}
                aria-label={photo.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={Boolean(photo.isFavorite)}
                icon={photo.isFavorite ? <HeartFilled /> : <HeartOutlined />}
                onClick={onToggle('favorite')}
              />
            </Tooltip>
            <Tooltip title={photo.isSaved ? 'Remove from saved' : 'Save'} mouseEnterDelay={0.6}>
              <Button
                shape="circle"
                className={`action-btn${photo.isSaved ? ' is-on' : ''}`}
                aria-label={photo.isSaved ? 'Remove from saved' : 'Save photo'}
                aria-pressed={Boolean(photo.isSaved)}
                icon={photo.isSaved ? <BookFilled /> : <BookOutlined />}
                onClick={onToggle('save')}
              />
            </Tooltip>
          </>
        )}
      </div>

      {isAdmin && (
        <div className="card-admin" onClick={stop}>
          <AdminMenu photo={photo} />
        </div>
      )}
    </div>
  );
}

function AdminMenu({ photo }: { photo: Photo }) {
  const { message, modal } = App.useApp();
  const softDelete = useSoftDelete();
  const restore = useRestore();
  const hardDelete = useHardDelete();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const deleted = Boolean(photo.deletedAt);

  const confirmHardDelete = () =>
    modal.confirm({
      title: 'Delete permanently?',
      icon: <ExclamationCircleFilled />,
      content: 'This permanently deletes the photo and its files. This cannot be undone.',
      okText: 'Delete permanently',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () =>
        hardDelete
          .mutateAsync(photo)
          .then(() => message.success('Photo permanently deleted'))
          .catch((err) => message.error(errorMessage(err, "Couldn't delete the photo"))),
    });

  const items: MenuProps['items'] = deleted
    ? [
        { key: 'restore', icon: <UndoOutlined />, label: 'Restore' },
        { type: 'divider' },
        { key: 'hard', icon: <DeleteOutlined />, label: 'Delete permanently', danger: true },
      ]
    : [
        { key: 'edit', icon: <EditOutlined />, label: 'Edit details' },
        { key: 'soft', icon: <DeleteOutlined />, label: 'Delete' },
        { type: 'divider' },
        { key: 'hard', icon: <DeleteOutlined />, label: 'Delete permanently', danger: true },
      ];

  const onMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'edit') setEditOpen(true);
    if (key === 'soft') setConfirmOpen(true);
    if (key === 'hard') confirmHardDelete();
    if (key === 'restore')
      restore
        .mutateAsync(photo)
        .then(() => message.success('Photo restored'))
        .catch((err) => message.error(errorMessage(err, "Couldn't restore the photo")));
  };

  return (
    <>
      <Popconfirm
        open={confirmOpen}
        title="Move this photo to trash? It can be restored."
        okText="Move to trash"
        cancelText="Cancel"
        placement="bottomRight"
        onOpenChange={(open) => !open && setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          softDelete
            .mutateAsync(photo)
            .then(() => message.success('Moved to trash'))
            .catch((err) => message.error(errorMessage(err, "Couldn't delete the photo")))
            .finally(() => setConfirmOpen(false))
        }
      >
        <span>
          <Dropdown menu={{ items, onClick: onMenu }} trigger={['click']} placement="bottomRight">
            <Button shape="circle" className="action-btn" aria-label="Photo admin actions" icon={<MoreOutlined />} />
          </Dropdown>
        </span>
      </Popconfirm>
      {editOpen && <EditModal photo={photo} onClose={() => setEditOpen(false)} />}
    </>
  );
}

function EditModal({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const { message } = App.useApp();
  const update = useUpdatePhoto();
  const [form] = Form.useForm<{ title: string; caption: string }>();
  return (
    <Modal
      open
      title="Edit photo details"
      okText="Save"
      confirmLoading={update.isPending}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then((v) =>
          update
            .mutateAsync({ id: photo.id, title: v.title ?? '', caption: v.caption ?? '' })
            .then(() => {
              message.success('Details updated');
              onClose();
            })
            .catch((err) => message.error(errorMessage(err, "Couldn't update the photo"))),
        )
      }
    >
      <Form form={form} layout="vertical" initialValues={{ title: photo.title ?? '', caption: photo.caption ?? '' }}>
        <Form.Item name="title" label="Title" rules={[{ max: 200 }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="caption" label="Caption" rules={[{ max: 1000 }]}>
          <Input.TextArea maxLength={1000} autoSize={{ minRows: 2, maxRows: 5 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export const PhotoCard = memo(PhotoCardInner);
