import { RequireAuth } from '../auth/RequireAuth';
import { emptyStates, GalleryView } from '../components/GalleryView';
import { ExportCsvButton } from '../components/ExportCsvButton';
import { useAuth } from '../auth/AuthContext';
import { useAlbumSelect } from '../components/AlbumSelectTools';

export function SavePage() {
  const { can } = useAuth();
  const { selection, selectButton, actions } = useAlbumSelect();
  return (
    <RequireAuth label="saved photos">
      {(can('photos.export') || selectButton) && (
        <div className="admin-filter">
          {can('photos.export') && (
            <ExportCsvButton
              main={{ key: 'mine', label: 'My saves', collection: 'saves', mine: true }}
              more={[{ key: 'everyone', label: "Everyone's saves (with who)", collection: 'saves' }]}
            />
          )}
          {selectButton}
        </div>
      )}
      <GalleryView scope="save" empty={emptyStates.save} selection={selection} selectionActions={actions} />
    </RequireAuth>
  );
}
