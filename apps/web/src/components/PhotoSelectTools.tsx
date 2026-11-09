import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App, Button } from 'antd';
import { CheckSquareOutlined, FolderAddOutlined } from '@ant-design/icons';
import { useAlbumPhotos } from '../api/albums';
import { errorMessage } from '../api/client';
import type { AlbumRef } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useSelection, type Selection } from '../hooks/useSelection';
import { AlbumPickerModal } from './AlbumPickerModal';

/** Router state set by an album's "Add photos" button: pick photos for that album. */
export interface SelectForState {
  selectFor?: AlbumRef;
}

/**
 * Select mode for album managers on a photo list. Returns the selection (pass it to GalleryView), the
 * "Select" toolbar button and the selection-bar actions. Opened from an album's "Add photos", it starts
 * in select mode with that album as the one-tap target.
 */
export function useAlbumSelect() {
  const { can } = useAuth();
  const enabled = can('albums.manage');
  const target = (useLocation().state as SelectForState | null)?.selectFor;
  const selection = useSelection(Boolean(enabled && target));
  return {
    selection: enabled ? selection : undefined,
    selectButton: enabled && !selection.active ? <SelectButton selection={selection} /> : null,
    actions: (ids: number[]) => <AddToAlbumActions ids={ids} selection={selection} target={target} />,
  };
}

function SelectButton({ selection }: { selection: Selection }) {
  return (
    <Button icon={<CheckSquareOutlined aria-hidden />} onClick={selection.start}>
      Select
    </Button>
  );
}

function AddToAlbumActions({ ids, selection, target }: { ids: number[]; selection: Selection; target?: AlbumRef }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const add = useAlbumPhotos();
  // The ids are fixed when the picker opens; leaving it after adding something ends select mode.
  const [picking, setPicking] = useState<number[] | null>(null);
  const added = useRef(false);
  const none = ids.length === 0;

  const addToTarget = async () => {
    if (!target) return;
    try {
      const res = await add.mutateAsync({ album: target, photoIds: ids });
      message.success(`Added ${res.changed} photo${res.changed === 1 ? '' : 's'} to ${target.name}`);
      selection.stop();
      navigate(`/albums/${target.slug}`);
    } catch (err) {
      message.error(errorMessage(err, "Couldn't add the photos"));
    }
  };

  return (
    <>
      {target && (
        <Button type="primary" icon={<FolderAddOutlined aria-hidden />} disabled={none} loading={add.isPending} onClick={addToTarget}>
          Add to {target.name}
        </Button>
      )}
      <Button type={target ? 'default' : 'primary'} icon={target ? undefined : <FolderAddOutlined aria-hidden />} disabled={none} onClick={() => setPicking(ids)}>
        {target ? 'Other album…' : 'Add to album…'}
      </Button>
      {picking && (
        <AlbumPickerModal
          photoIds={picking}
          onAdded={() => (added.current = true)}
          onClose={() => {
            setPicking(null);
            if (added.current) selection.stop();
            added.current = false;
          }}
        />
      )}
    </>
  );
}
