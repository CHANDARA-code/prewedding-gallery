import { ReactNode, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App, Button, Checkbox, Dropdown, Form, Input, Modal, Tooltip, type MenuProps } from 'antd';
import {
  BookOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  FileExcelOutlined,
  FolderAddOutlined,
  HeartFilled,
  HeartOutlined,
  BookFilled,
  LinkOutlined,
  MoreOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useAlbumPhotos } from '../api/albums';
import { errorMessage } from '../api/client';
import {
  downloadPhotosCsv,
  downloadPhotosZip,
  useAdminBatch,
  useBatchEdit,
  useBatchToggle,
  useRotateMany,
  ZIP_MAX,
  type AdminBatch,
} from '../api/photos';
import type { AlbumRef, Photo } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useSelection, type Selection } from '../hooks/useSelection';
import { AlbumPickerModal } from './AlbumPickerModal';
import { ShareLinkModal } from './ShareLinkModal';

/** Router state set by an album's "Add photos" button: pick photos for that album. */
export interface SelectForState {
  selectFor?: AlbumRef;
}

const photos = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;

/**
 * Select mode on a photo list. Everyone can select (guests to download); what the bar offers follows
 * the account's permissions. Returns the selection (pass it to GalleryView), the "Select" toolbar
 * button and the selection-bar actions. Opened from an album's "Add photos", it starts in select mode
 * with that album as the one-tap target.
 */
export function usePhotoSelect() {
  const { can } = useAuth();
  const routed = (useLocation().state as SelectForState | null)?.selectFor;
  const target = can('albums.manage') ? routed : undefined;
  const selection = useSelection(Boolean(target));
  return {
    selection,
    selectButton: selection.active ? null : <SelectButton selection={selection} />,
    actions: (selected: Photo[]) => <SelectionActions selected={selected} selection={selection} target={target} />,
  };
}

export function SelectButton({ selection }: { selection: Selection }) {
  return (
    <Button icon={<CheckSquareOutlined aria-hidden />} onClick={selection.start}>
      Select
    </Button>
  );
}

interface ActionsProps {
  selected: Photo[];
  selection: Selection;
  /** Album an "Add photos" trip is picking for: a one-tap "Add to {name}". */
  target?: AlbumRef;
  /** Page-specific buttons shown first (e.g. an album's cover / remove). */
  extra?: ReactNode;
}

/**
 * Every action that works on one photo, for the whole selection: favorite, save, download (ZIP), share
 * link, rotate, add to album, edit title/caption, export CSV, move to trash, restore and delete forever.
 */
export function SelectionActions({ selected, selection, target, extra }: ActionsProps) {
  const { user, can } = useAuth();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const favorite = useBatchToggle('favorite');
  const save = useBatchToggle('save');
  const admin = useAdminBatch();
  const addToAlbum = useAlbumPhotos();
  const [picking, setPicking] = useState<number[] | null>(null);
  const [editing, setEditing] = useState<number[] | null>(null);
  const [sharing, setSharing] = useState<number[] | null>(null);
  const added = useRef(false);

  const ids = selected.map((p) => p.id);
  const active = selected.filter((p) => !p.deletedAt);
  const trashed = selected.filter((p) => p.deletedAt);
  const activeIds = active.map((p) => p.id);
  const none = selected.length === 0;
  const noActive = active.length === 0;
  const allFav = !noActive && active.every((p) => p.isFavorite);
  const allSaved = !noActive && active.every((p) => p.isSaved);

  const toggle = async (kind: 'favorite' | 'save', on: boolean) => {
    const m = kind === 'favorite' ? favorite : save;
    try {
      const res = await m.mutateAsync({ ids: activeIds, on });
      const verb = kind === 'favorite' ? (on ? 'Favorited' : 'Removed from favorites:') : on ? 'Saved' : 'Removed from saved:';
      message.success(`${verb} ${photos(on ? active.length : res.changed)}`);
    } catch (err) {
      message.error(errorMessage(err, `Couldn't update your ${kind === 'favorite' ? 'favorites' : 'saved photos'}`));
    }
  };

  const download = () => {
    const zips = downloadPhotosZip(activeIds);
    message.info(
      zips > 1
        ? `Downloading ${photos(activeIds.length)} as ${zips} ZIP files (up to ${ZIP_MAX} each). Allow multiple downloads if your browser asks.`
        : `Downloading ${photos(activeIds.length)} as a ZIP…`,
    );
  };

  const exportCsv = async () => {
    const done = message.loading(`Preparing a CSV of ${photos(ids.length)}…`, 0);
    try {
      message.success(`Downloaded ${await downloadPhotosCsv({ ids })}`);
    } catch (err) {
      message.error(errorMessage(err, "Couldn't export the CSV"));
    } finally {
      done();
    }
  };

  const runAdmin = (action: AdminBatch, targets: number[]) => {
    const copy = {
      trash: { title: `Move ${photos(targets.length)} to trash?`, body: 'They disappear from every list and album until restored.', ok: 'Move to trash', done: 'Moved to trash:' },
      restore: { title: `Restore ${photos(targets.length)}?`, body: 'They come back to every list and album they were in.', ok: 'Restore', done: 'Restored' },
      purge: {
        title: `Delete ${photos(targets.length)} forever?`,
        body: 'The files, favorites, saves and album entries are removed. This cannot be undone.',
        ok: 'Delete forever',
        done: 'Permanently deleted',
      },
    }[action];
    modal.confirm({
      title: copy.title,
      icon: <ExclamationCircleFilled />,
      content: copy.body,
      okText: copy.ok,
      okButtonProps: { danger: action !== 'restore' },
      onOk: () =>
        admin
          .mutateAsync({ action, ids: targets })
          .then((r) => {
            message.success(`${copy.done} ${photos(r.changed)}`);
            selection.stop();
          })
          .catch((err) => message.error(errorMessage(err, "Couldn't update the photos"))),
    });
  };

  const addToTarget = async () => {
    if (!target) return;
    try {
      const res = await addToAlbum.mutateAsync({ album: target, photoIds: activeIds });
      message.success(`Added ${photos(res.changed)} to ${target.name}`);
      selection.stop();
      navigate(`/albums/${target.slug}`);
    } catch (err) {
      message.error(errorMessage(err, "Couldn't add the photos"));
    }
  };

  const more: MenuProps['items'] = [
    ...(can('photos.edit') ? [{ key: 'edit', icon: <EditOutlined />, label: 'Edit title & caption…', disabled: none }] : []),
    ...(can('photos.export') ? [{ key: 'csv', icon: <FileExcelOutlined />, label: 'Export CSV of selected', disabled: none }] : []),
    ...(can('photos.delete') && trashed.length ? [{ key: 'restore', icon: <UndoOutlined />, label: `Restore ${photos(trashed.length)}` }] : []),
    ...(can('photos.delete') && active.length ? [{ type: 'divider' as const }, { key: 'trash', icon: <DeleteOutlined />, label: 'Move to trash', danger: true }] : []),
    ...(can('photos.purge') && !none ? [{ key: 'purge', icon: <DeleteOutlined />, label: 'Delete forever…', danger: true }] : []),
  ];

  return (
    <>
      {extra}
      {target && (
        <Button type="primary" icon={<FolderAddOutlined aria-hidden />} disabled={noActive} loading={addToAlbum.isPending} onClick={addToTarget}>
          Add to {target.name}
        </Button>
      )}
      {user && (
        <>
          <Tooltip title={allFav ? 'Remove from favorites' : 'Favorite'}>
            <Button
              className="icon-action"
              icon={allFav ? <HeartFilled /> : <HeartOutlined />}
              aria-label={allFav ? 'Unfavorite selected' : 'Favorite selected'}
              aria-pressed={allFav}
              disabled={noActive}
              loading={favorite.isPending}
              onClick={() => toggle('favorite', !allFav)}
            />
          </Tooltip>
          <Tooltip title={allSaved ? 'Remove from saved' : 'Save'}>
            <Button
              className="icon-action"
              icon={allSaved ? <BookFilled /> : <BookOutlined />}
              aria-label={allSaved ? 'Unsave selected' : 'Save selected'}
              aria-pressed={allSaved}
              disabled={noActive}
              loading={save.isPending}
              onClick={() => toggle('save', !allSaved)}
            />
          </Tooltip>
        </>
      )}
      {user ? (
        <Tooltip title="Download originals (ZIP)">
          <Button className="icon-action" icon={<DownloadOutlined />} aria-label="Download selected" disabled={noActive} onClick={download} />
        </Tooltip>
      ) : (
        // A guest's only action: give it words.
        <Button type="primary" icon={<DownloadOutlined aria-hidden />} aria-label="Download selected" disabled={noActive} onClick={download}>
          Download
        </Button>
      )}
      {user && (
        <Tooltip title="Share link (public or for chosen people)">
          <Button className="icon-action" icon={<LinkOutlined />} aria-label="Share selected as a link" disabled={noActive} onClick={() => setSharing(activeIds)} />
        </Tooltip>
      )}
      {can('photos.edit') && <RotateActions ids={activeIds} />}
      {can('albums.manage') && (
        <Button
          type={target ? 'default' : 'primary'}
          icon={target ? undefined : <FolderAddOutlined aria-hidden />}
          disabled={noActive}
          onClick={() => setPicking(activeIds)}
        >
          {target ? 'Other album…' : 'Add to album…'}
        </Button>
      )}
      {trashed.length > 0 && active.length === 0 && can('photos.delete') && (
        <Button type="primary" icon={<UndoOutlined aria-hidden />} onClick={() => runAdmin('restore', trashed.map((p) => p.id))}>
          Restore
        </Button>
      )}
      {more.length > 0 && (
        <Dropdown
          trigger={['click']}
          placement="topRight"
          menu={{
            items: more,
            onClick: ({ key }) => {
              if (key === 'edit') setEditing(ids);
              if (key === 'csv') void exportCsv();
              if (key === 'restore') runAdmin('restore', trashed.map((p) => p.id));
              if (key === 'trash') runAdmin('trash', activeIds);
              if (key === 'purge') runAdmin('purge', ids);
            },
          }}
        >
          <Button className="icon-action" icon={<MoreOutlined />} aria-label="More actions for selected" disabled={none} />
        </Dropdown>
      )}

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
      {editing && <BatchEditModal ids={editing} onClose={() => setEditing(null)} />}
      {sharing && <ShareLinkModal photoIds={sharing} onClose={() => setSharing(null)} />}
    </>
  );
}

/**
 * Rotate left / right for every selected photo. The selection stays, so a wrong turn is one tap to undo.
 * Big selections go in batches with a progress toast.
 */
export function RotateActions({ ids }: { ids: number[] }) {
  const { message } = App.useApp();
  const rotate = useRotateMany();
  const [turning, setTurning] = useState<90 | -90 | null>(null);
  const none = ids.length === 0;

  const run = async (degrees: 90 | -90) => {
    const key = 'rotate-many';
    const total = ids.length;
    setTurning(degrees);
    if (total > 1) message.loading({ key, content: `Rotating ${photos(total)}…`, duration: 0 });
    try {
      const res = await rotate.mutateAsync({
        ids: [...ids],
        degrees,
        onProgress: (done, all) => done < all && message.loading({ key, content: `Rotating… ${done} of ${all}`, duration: 0 }),
      });
      if (res.error) {
        message.error({ key, content: `${errorMessage(res.error, "Couldn't rotate the photos")}${res.rotated ? ` (${res.rotated} of ${total} rotated)` : ''}` });
      } else if (res.failed.length) {
        message.warning({ key, content: `Rotated ${res.rotated} of ${total}. ${photos(res.failed.length)} couldn't be rotated.` });
      } else {
        message.success({ key, content: `Rotated ${photos(res.rotated)} ${degrees > 0 ? 'right' : 'left'}, everywhere` });
      }
    } finally {
      setTurning(null);
    }
  };

  return (
    <>
      <Tooltip title="Rotate left (applies everywhere)">
        <Button
          className="icon-action"
          icon={<RotateLeftOutlined />}
          aria-label="Rotate selected left"
          disabled={none || (turning !== null && turning !== -90)}
          loading={turning === -90}
          onClick={() => run(-90)}
        />
      </Tooltip>
      <Tooltip title="Rotate right (applies everywhere)">
        <Button
          className="icon-action"
          icon={<RotateRightOutlined />}
          aria-label="Rotate selected right"
          disabled={none || (turning !== null && turning !== 90)}
          loading={turning === 90}
          onClick={() => run(90)}
        />
      </Tooltip>
    </>
  );
}

/** Title / caption for many photos: only the ticked fields change; ticked and empty clears it. */
function BatchEditModal({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const { message } = App.useApp();
  const edit = useBatchEdit();
  const [form] = Form.useForm<{ setTitle: boolean; title: string; setCaption: boolean; caption: string }>();
  const setTitle = Form.useWatch('setTitle', form);
  const setCaption = Form.useWatch('setCaption', form);

  const submit = async () => {
    const v = await form.validateFields();
    try {
      const res = await edit.mutateAsync({
        ids,
        title: v.setTitle ? (v.title ?? '').trim() : undefined,
        caption: v.setCaption ? (v.caption ?? '').trim() : undefined,
      });
      message.success(`Updated ${photos(res.changed)}`);
      onClose();
    } catch (err) {
      message.error(errorMessage(err, "Couldn't update the photos"));
    }
  };

  return (
    <Modal
      open
      title={`Edit ${photos(ids.length)}`}
      okText="Apply"
      onOk={submit}
      okButtonProps={{ disabled: !setTitle && !setCaption, loading: edit.isPending }}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ setTitle: true, title: '', setCaption: false, caption: '' }}>
        <Form.Item name="setTitle" valuePropName="checked" style={{ marginBottom: 4 }}>
          <Checkbox>Set title</Checkbox>
        </Form.Item>
        <Form.Item name="title" extra={setTitle ? 'Leave empty to clear the title.' : 'Each photo keeps its own title.'}>
          <Input disabled={!setTitle} maxLength={200} placeholder="e.g. Barsat Angkor Wat" aria-label="Title" />
        </Form.Item>
        <Form.Item name="setCaption" valuePropName="checked" style={{ marginBottom: 4 }}>
          <Checkbox>Set caption</Checkbox>
        </Form.Item>
        <Form.Item name="caption" extra={setCaption ? 'Leave empty to clear the caption.' : 'Each photo keeps its own caption.'}>
          <Input.TextArea disabled={!setCaption} maxLength={1000} autoSize={{ minRows: 2, maxRows: 5 }} aria-label="Caption" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
