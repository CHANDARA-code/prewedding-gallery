import { RequireAuth } from '../auth/RequireAuth';
import { emptyStates, GalleryView } from '../components/GalleryView';
import { ExportCsvButton } from '../components/ExportCsvButton';
import { useAuth } from '../auth/AuthContext';

export function FavoritePage() {
  const { can } = useAuth();
  return (
    <RequireAuth label="favorites">
      {can('photos.export') && (
        <div className="admin-filter">
          <ExportCsvButton
            main={{ key: 'mine', label: 'My favorites', collection: 'favorites', mine: true }}
            more={[{ key: 'everyone', label: "Everyone's favorites (with who)", collection: 'favorites' }]}
          />
        </div>
      )}
      <GalleryView scope="favorite" empty={emptyStates.favorite} />
    </RequireAuth>
  );
}
