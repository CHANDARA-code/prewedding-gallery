import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Empty, Result, Tag } from 'antd';
import { FolderOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useAlbums } from '../api/albums';
import { errorMessage } from '../api/client';
import type { Album } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { assetUrl } from '../config';
import { AlbumFormModal } from '../components/AlbumFormModal';

export function AlbumsPage() {
  const { can } = useAuth();
  const manage = can('albums.manage');
  const navigate = useNavigate();
  const albums = useAlbums();
  const [creating, setCreating] = useState(false);

  return (
    <>
      {manage && (
        <div className="admin-filter">
          <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => setCreating(true)}>
            New album
          </Button>
        </div>
      )}
      {albums.isPending ? (
        <ul className="album-grid" aria-busy="true" aria-label="Loading albums">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="album-card is-skeleton" />
          ))}
        </ul>
      ) : albums.isError ? (
        <Result
          status="warning"
          title="Couldn't load albums"
          subTitle={errorMessage(albums.error, 'Please check your connection and try again.')}
          extra={
            <Button type="primary" icon={<ReloadOutlined aria-hidden />} onClick={() => albums.refetch()}>
              Retry
            </Button>
          }
        />
      ) : albums.data.length === 0 ? (
        <div className="center-state">
          <Empty description={manage ? 'No albums yet. Create one, then add photos to it.' : 'No albums yet. Check back soon.'} />
        </div>
      ) : (
        <ul className="album-grid" aria-label="Albums">
          {albums.data.map((a) => (
            <li key={a.id}>
              <AlbumCard album={a} />
            </li>
          ))}
        </ul>
      )}
      {creating && <AlbumFormModal onClose={() => setCreating(false)} onSaved={(a) => navigate(`/albums/${a.slug}`)} />}
    </>
  );
}

function AlbumCard({ album }: { album: Album }) {
  const n = album.photoCount;
  return (
    <Link to={`/albums/${album.slug}`} className={`album-card${album.hidden ? ' is-hidden' : ''}`}>
      <span className="album-cover">
        {album.cover ? (
          <img src={assetUrl(album.cover.thumbUrl)} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <FolderOutlined className="album-cover-empty" aria-hidden />
        )}
      </span>
      <span className="album-meta">
        <span className="album-name serif-title">{album.name}</span>
        <span className="album-count">
          {n} photo{n === 1 ? '' : 's'}
          {album.hidden && (
            <Tag bordered={false} className="album-hidden-tag">
              Hidden
            </Tag>
          )}
        </span>
      </span>
    </Link>
  );
}
