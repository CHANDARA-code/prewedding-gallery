import { RequireAuth } from '../auth/RequireAuth';
import { emptyStates, GalleryView } from '../components/GalleryView';

export function SavePage() {
  return (
    <RequireAuth label="saved photos">
      <GalleryView scope="save" empty={emptyStates.save} />
    </RequireAuth>
  );
}
