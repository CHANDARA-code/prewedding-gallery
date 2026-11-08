import { App, Form, Input, Modal, Switch } from 'antd';
import { useCreateAlbum, useUpdateAlbum } from '../api/albums';
import { errorMessage } from '../api/client';
import type { Album } from '../api/types';

interface Values {
  name: string;
  description?: string;
  slug?: string;
  hidden: boolean;
}

/** Create an album (no `album`) or edit one's name, description, link name and visibility. */
export function AlbumFormModal({ album, onClose, onSaved }: { album?: Album; onClose: () => void; onSaved?: (a: Album) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const create = useCreateAlbum();
  const update = useUpdateAlbum();
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    const v = await form.validateFields();
    const body = { name: v.name.trim(), description: v.description?.trim() || null, hidden: v.hidden };
    try {
      const saved = album
        ? await update.mutateAsync({ id: album.id, ...body, ...(v.slug && v.slug !== album.slug && { slug: v.slug }) })
        : await create.mutateAsync(body);
      message.success(album ? 'Album updated' : `Created ${saved.name}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      message.error(errorMessage(err, "Couldn't save the album"));
    }
  };

  return (
    <Modal open title={album ? 'Edit album' : 'New album'} okText={album ? 'Save' : 'Create'} confirmLoading={busy} onOk={submit} onCancel={onClose} destroyOnHidden>
      <Form<Values>
        form={form}
        layout="vertical"
        initialValues={{ name: album?.name ?? '', description: album?.description ?? '', slug: album?.slug, hidden: album?.hidden ?? false }}
        onFinish={submit}
      >
        <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, message: 'Give the album a name' }, { max: 120 }]}>
          <Input placeholder="Barsat Angkor Wat" maxLength={120} autoFocus />
        </Form.Item>
        <Form.Item name="description" label="Description" rules={[{ max: 1000 }]}>
          <Input.TextArea placeholder="Optional" maxLength={1000} autoSize={{ minRows: 2, maxRows: 5 }} />
        </Form.Item>
        {album && (
          <Form.Item
            name="slug"
            label="Link name"
            extra={`${window.location.origin}/albums/… — changing it breaks links already shared.`}
            rules={[
              { required: true, message: 'A link name is required' },
              { max: 60 },
              { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: 'Lowercase letters, digits and single dashes only' },
            ]}
          >
            <Input maxLength={60} />
          </Form.Item>
        )}
        <Form.Item name="hidden" label="Hidden" valuePropName="checked" extra="Hidden albums are only visible to people who manage albums. Publish when it's ready.">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
