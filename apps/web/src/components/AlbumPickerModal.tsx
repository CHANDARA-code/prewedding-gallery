import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Empty, Input, Modal, Spin, Tag } from 'antd';
import { CheckOutlined, FolderOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useAlbumPhotos, useAlbums, useCreateAlbum } from '../api/albums';
import { errorMessage } from '../api/client';
import type { Album } from '../api/types';
import { assetUrl } from '../config';

interface Props {
  photoIds: number[];
  /** One photo: the albums it is already in, so each row toggles membership. */
  memberOf?: number[];
  onClose: () => void;
  /** After photos were added (e.g. to leave select mode). */
  onAdded?: (album: Album) => void;
}

const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;

/** Put photos into an existing album or a new one; for a single photo, also take it out again. */
export function AlbumPickerModal({ photoIds, memberOf, onClose, onAdded }: Props) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const albums = useAlbums();
  const change = useAlbumPhotos();
  const create = useCreateAlbum();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  // Albums these photos are in now (single photo), or were added to in this dialog.
  const [inAlbum, setInAlbum] = useState<Set<number>>(() => new Set(memberOf ?? []));
  const single = memberOf !== undefined;
  const what = photoIds.length === 1 ? 'this photo' : plural(photoIds.length);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (albums.data ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [albums.data, query]);

  // Toasts render outside the router, so this is a plain link driven by the captured navigate().
  const link = (a: Pick<Album, 'slug' | 'name'>) => (
    <a
      href={`/albums/${a.slug}`}
      onClick={(e) => {
        e.preventDefault();
        onClose();
        navigate(`/albums/${a.slug}`);
      }}
    >
      {a.name}
    </a>
  );

  const toggle = async (album: Album) => {
    const remove = single && inAlbum.has(album.id);
    setBusyId(album.id);
    try {
      const res = await change.mutateAsync({ album, photoIds, remove });
      setInAlbum((prev) => {
        const next = new Set(prev);
        if (remove) next.delete(album.id);
        else next.add(album.id);
        return next;
      });
      if (remove) message.success(<>Removed from {link(album)}</>);
      else {
        const skipped = photoIds.length - res.changed;
        message.success(
          <>
            Added {res.changed ? plural(res.changed) : 'nothing new'} to {link(album)}
            {skipped > 0 && res.changed > 0 ? ` (${skipped} already there)` : ''}
          </>,
        );
        onAdded?.(res.album);
      }
    } catch (err) {
      message.error(errorMessage(err, "Couldn't update the album"));
    } finally {
      setBusyId(null);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const album = await create.mutateAsync({ name, photoIds });
      setNewName('');
      setInAlbum((prev) => new Set(prev).add(album.id));
      message.success(<>Created {link(album)} with {plural(album.photoCount)}</>);
      onAdded?.(album);
    } catch (err) {
      message.error(errorMessage(err, "Couldn't create the album"));
    }
  };

  return (
    <Modal
      open
      title={single ? 'Albums for this photo' : `Add ${what} to an album`}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
      destroyOnHidden
    >
      <div className="album-picker">
        <div className="album-picker-new">
          <Input
            placeholder="New album name, e.g. Barsat Angkor Wat"
            value={newName}
            maxLength={120}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={createAndAdd}
            aria-label="New album name"
          />
          <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={createAndAdd} loading={create.isPending} disabled={!newName.trim()}>
            Create
          </Button>
        </div>

        {(albums.data?.length ?? 0) > 6 && (
          <Input
            allowClear
            prefix={<SearchOutlined aria-hidden />}
            placeholder="Find an album"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find an album"
          />
        )}

        {albums.isPending ? (
          <div className="album-picker-state">
            <Spin />
          </div>
        ) : shown.length === 0 ? (
          <Empty className="album-picker-state" description={query ? 'No album matches' : 'No albums yet. Name one above.'} />
        ) : (
          <ul className="album-picker-list" aria-label="Albums">
            {shown.map((a) => {
              const added = inAlbum.has(a.id);
              return (
                <li key={a.id} className="album-picker-row">
                  <span className="album-picker-thumb" aria-hidden>
                    {a.cover ? <img src={assetUrl(a.cover.thumbUrl)} alt="" loading="lazy" /> : <FolderOutlined />}
                  </span>
                  <span className="album-picker-name">
                    <span>{a.name}</span>
                    <small>
                      {plural(a.photoCount)}
                      {a.hidden && (
                        <Tag bordered={false} className="album-hidden-tag">
                          Hidden
                        </Tag>
                      )}
                    </small>
                  </span>
                  <Button
                    size="small"
                    type={added ? 'default' : 'primary'}
                    ghost={!added}
                    icon={added ? <CheckOutlined aria-hidden /> : <PlusOutlined aria-hidden />}
                    loading={busyId === a.id}
                    disabled={busyId !== null && busyId !== a.id}
                    onClick={() => (added && !single ? undefined : toggle(a))}
                    aria-label={added ? (single ? `Remove from ${a.name}` : `Added to ${a.name}`) : `Add to ${a.name}`}
                    title={added && single ? 'Click to remove it from this album' : undefined}
                  >
                    {added ? 'Added' : 'Add'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
