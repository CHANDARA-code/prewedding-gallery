import { RequireAuth } from '../auth/RequireAuth';
import { emptyStates, GalleryView } from '../components/GalleryView';

export function FavoritePage() {
  return (
    <RequireAuth label="favorites">
      <GalleryView scope="favorite" empty={emptyStates.favorite} />
    </RequireAuth>
  );
}
