import { RequireAuth } from '../auth/RequireAuth';
import { emptyStates, GalleryView } from '../components/GalleryView';
import { ExportCsvButton } from '../components/ExportCsvButton';
import { useAuth } from '../auth/AuthContext';

export function SavePage() {
  const { can } = useAuth();
  return (
    <RequireAuth label="saved photos">
      {can('photos.export') && (
        <div className="admin-filter">
          <ExportCsvButton
            main={{ key: 'mine', label: 'My saves', collection: 'saves', mine: true }}
            more={[{ key: 'everyone', label: "Everyone's saves (with who)", collection: 'saves' }]}
          />
        </div>
      )}
      <GalleryView scope="save" empty={emptyStates.save} />
    </RequireAuth>
  );
}
