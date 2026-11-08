import { RequireAuth } from '../auth/RequireAuth';
import { emptyStates, GalleryView } from '../components/GalleryView';
import { ExportCsvButton } from '../components/ExportCsvButton';
import { useAuth } from '../auth/AuthContext';
import { useAlbumSelect } from '../components/AlbumSelectTools';

export function FavoritePage() {
  const { can } = useAuth();
  const { selection, selectButton, actions } = useAlbumSelect();
  return (
    <RequireAuth label="favorites">
      {(can('photos.export') || selectButton) && (
        <div className="admin-filter">
          {can('photos.export') && (
            <ExportCsvButton
              main={{ key: 'mine', label: 'My favorites', collection: 'favorites', mine: true }}
              more={[{ key: 'everyone', label: "Everyone's favorites (with who)", collection: 'favorites' }]}
            />
          )}
          {selectButton}
        </div>
      )}
      <GalleryView scope="favorite" empty={emptyStates.favorite} selection={selection} selectionActions={actions} />
    </RequireAuth>
  );
}
