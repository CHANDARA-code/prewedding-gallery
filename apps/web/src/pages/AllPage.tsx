import { useState } from 'react';
import { Segmented } from 'antd';
import { ExportCsvButton } from '../components/ExportCsvButton';
import { useAlbumSelect } from '../components/AlbumSelectTools';
import type { AdminStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { emptyStates, GalleryView } from '../components/GalleryView';

// Survives tab switches (the page unmounts) without putting it in the URL.
let lastAdminStatus: AdminStatus = 'active';

export function AllPage() {
  const { can } = useAuth();
  const seesTrash = can('photos.delete');
  const canExport = can('photos.export');
  const [status, setStatus] = useState<AdminStatus>(lastAdminStatus);
  const { selection, selectButton, actions } = useAlbumSelect();

  const statusLabel = { active: 'Active photos', deleted: 'Photos in trash', all: 'All photos incl. trash' }[status];
  const toolbar = (seesTrash || canExport || selection) && (
    <div className="admin-filter">
      {seesTrash && (
        <Segmented<AdminStatus>
          value={status}
          onChange={(v) => {
            lastAdminStatus = v;
            setStatus(v);
            window.scrollTo({ top: 0 });
          }}
          options={[
            { label: 'Active', value: 'active' },
            { label: 'Trash', value: 'deleted' },
            { label: 'All', value: 'all' },
          ]}
          aria-label="Photo status filter"
        />
      )}
      {canExport && (
        <ExportCsvButton
          main={{ key: 'filter', label: `${statusLabel} (this filter)`, status }}
          more={[
            { key: 'fav', label: 'Only favorited photos (who favorited)', collection: 'favorites' },
            { key: 'save', label: 'Only saved photos (who saved)', collection: 'saves' },
          ]}
        />
      )}
      {selectButton}
    </div>
  );

  return (
    <>
      {toolbar}
      {seesTrash ? (
        <GalleryView
          key={status}
          scope="admin"
          status={status}
          empty={status === 'deleted' ? emptyStates.trash : emptyStates.all}
          selection={selection}
          selectionActions={actions}
        />
      ) : (
        <GalleryView scope="all" empty={emptyStates.all} selection={selection} selectionActions={actions} />
      )}
    </>
  );
}
