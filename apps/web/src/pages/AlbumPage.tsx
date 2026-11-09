import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { App, Button, Dropdown, Empty, Popconfirm, Result, Skeleton, Tag } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  EyeInvisibleOutlined,
  EyeOutlined,
  LeftOutlined,
  MinusCircleOutlined,
  MoreOutlined,
  PictureOutlined,
  PlusOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { useAlbum, useAlbumPhotos, useDeleteAlbum, useUpdateAlbum } from '../api/albums';
import { errorMessage } from '../api/client';
import type { Album } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useSelection, type Selection } from '../hooks/useSelection';
import { copyText, isMobileDevice } from '../share/share';
import { GalleryView } from '../components/GalleryView';
import { GridSkeleton } from '../components/PhotoGrid';
import { ExportCsvButton } from '../components/ExportCsvButton';
import { AlbumFormModal } from '../components/AlbumFormModal';
import { SelectButton, SelectionActions, type SelectForState } from '../components/PhotoSelectTools';

export function AlbumPage() {
  const { slug = '' } = useParams();
  const { can } = useAuth();
  const manage = can('albums.manage');
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const album = useAlbum(slug);
  const update = useUpdateAlbum();
  const del = useDeleteAlbum();
  const selection = useSelection();
  const [editing, setEditing] = useState(false);

  if (album.isPending) {
    return (
      <>
        <div className="album-header">
          <Skeleton active title={{ width: 240 }} paragraph={{ rows: 1, width: 160 }} />
        </div>
        <GridSkeleton columns={3} rows={2} />
      </>
    );
  }
  if (album.isError) {
    return (
      <Result
        status="404"
        title="Album not found"
        subTitle="It may have been renamed or removed."
        extra={
          <Link to="/albums">
            <Button type="primary">See all albums</Button>
          </Link>
        }
      />
    );
  }

  const a = album.data;
  const n = a.photoCount;
  const addPhotos = () => navigate('/', { state: { selectFor: { id: a.id, slug: a.slug, name: a.name } } satisfies SelectForState });

  const share = async () => {
    const url = `${window.location.origin}/albums/${a.slug}`;
    if (isMobileDevice() && navigator.share) {
      await navigator.share({ title: a.name, text: a.description ?? a.name, url }).catch(() => undefined);
      return;
    }
    message[(await copyText(url)) ? 'success' : 'error']('Album link copied');
  };

  const setHidden = (hidden: boolean) =>
    update
      .mutateAsync({ id: a.id, hidden })
      .then(() => message.success(hidden ? 'Album hidden from guests' : 'Album published'))
      .catch((err) => message.error(errorMessage(err, "Couldn't update the album")));

  const confirmDelete = () =>
    modal.confirm({
      title: `Delete “${a.name}”?`,
      icon: <ExclamationCircleFilled />,
      content: 'Only the album is deleted. Its photos stay in the gallery, with their favorites and saves.',
      okText: 'Delete album',
      okButtonProps: { danger: true },
      onOk: () =>
        del
          .mutateAsync(a)
          .then(() => {
            message.success('Album deleted');
            navigate('/albums', { replace: true });
          })
          .catch((err) => message.error(errorMessage(err, "Couldn't delete the album"))),
    });

  return (
    <>
      <div className="album-header">
        <Link to="/albums" className="album-back">
          <LeftOutlined aria-hidden /> Albums
        </Link>
        <h1 className="album-title serif-title">
          {a.name}
          {a.hidden && (
            <Tag bordered={false} className="album-hidden-tag">
              Hidden
            </Tag>
          )}
        </h1>
        {a.description && <p className="album-description">{a.description}</p>}
        <p className="album-count">
          <PictureOutlined aria-hidden /> {n} photo{n === 1 ? '' : 's'}
        </p>
      </div>

      <div className="admin-filter">
        <Button icon={<ShareAltOutlined aria-hidden />} onClick={share}>
          Share
        </Button>
        {!selection.active && n > 0 && <SelectButton selection={selection} />}
        <ExportCsvButton
          main={{ key: 'album', label: 'This album', album: a.id }}
          more={[
            { key: 'fav', label: 'Favorited in this album (who favorited)', album: a.id, collection: 'favorites' },
            { key: 'save', label: 'Saved in this album (who saved)', album: a.id, collection: 'saves' },
          ]}
        />
        {manage && (
          <>
            <Button icon={<PlusOutlined aria-hidden />} onClick={addPhotos}>
              Add photos
            </Button>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  { key: 'edit', icon: <EditOutlined />, label: 'Edit details' },
                  a.hidden
                    ? { key: 'publish', icon: <EyeOutlined />, label: 'Publish (show to everyone)' }
                    : { key: 'hide', icon: <EyeInvisibleOutlined />, label: 'Hide from guests' },
                  { type: 'divider' },
                  { key: 'delete', icon: <DeleteOutlined />, label: 'Delete album', danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === 'edit') setEditing(true);
                  if (key === 'publish') setHidden(false);
                  if (key === 'hide') setHidden(true);
                  if (key === 'delete') confirmDelete();
                },
              }}
            >
              <Button icon={<MoreOutlined />} aria-label="Album actions" />
            </Dropdown>
          </>
        )}
      </div>

      <GalleryView
        key={a.slug}
        scope="album"
        album={a.slug}
        empty={
          <Empty description="No photos in this album yet.">
            {manage && (
              <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={addPhotos}>
                Add photos
              </Button>
            )}
          </Empty>
        }
        selection={selection}
        selectionActions={(selected) => (
          <SelectionActions
            selected={selected}
            selection={selection}
            extra={manage && <AlbumSelectionActions album={a} ids={selected.map((p) => p.id)} selection={selection} />}
          />
        )}
      />

      {editing && (
        <AlbumFormModal
          album={a}
          onClose={() => setEditing(false)}
          onSaved={(saved) => saved.slug !== a.slug && navigate(`/albums/${saved.slug}`, { replace: true })}
        />
      )}
    </>
  );
}

/** Album-only select-mode actions for album managers: set the cover, remove from this album. */
function AlbumSelectionActions({ album, ids, selection }: { album: Album; ids: number[]; selection: Selection }) {
  const { message } = App.useApp();
  const change = useAlbumPhotos();
  const update = useUpdateAlbum();
  const none = ids.length === 0;
  const isCover = ids.length === 1 && album.cover?.id === ids[0] && album.coverPhotoId !== null;

  const remove = () =>
    change
      .mutateAsync({ album, photoIds: ids, remove: true })
      .then((r) => {
        message.success(`Removed ${r.changed} photo${r.changed === 1 ? '' : 's'} from the album`);
        selection.stop();
      })
      .catch((err) => message.error(errorMessage(err, "Couldn't remove the photos")));

  const setCover = () =>
    update
      .mutateAsync({ id: album.id, coverPhotoId: isCover ? null : ids[0] })
      .then(() => {
        message.success(isCover ? 'Cover set back to automatic' : 'Album cover updated');
        selection.stop();
      })
      .catch((err) => message.error(errorMessage(err, "Couldn't set the cover")));

  return (
    <>
      {ids.length === 1 && (
        <Button onClick={setCover} loading={update.isPending} icon={<PictureOutlined aria-hidden />}>
          {isCover ? 'Automatic cover' : 'Set as cover'}
        </Button>
      )}
      <Popconfirm
        title={`Remove ${ids.length} photo${ids.length === 1 ? '' : 's'} from “${album.name}”?`}
        description="The photos stay in the gallery."
        okText="Remove"
        onConfirm={remove}
        disabled={none}
      >
        <Button danger disabled={none} loading={change.isPending} icon={<MinusCircleOutlined aria-hidden />}>
          Remove
        </Button>
      </Popconfirm>
    </>
  );
}
