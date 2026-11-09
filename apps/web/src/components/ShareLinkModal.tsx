import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Form, Input, Modal, Radio, Select, Space, Typography } from 'antd';
import { CopyOutlined, GlobalOutlined, LockOutlined, ShareAltOutlined } from '@ant-design/icons';
import { errorMessage } from '../api/client';
import { shareLinkUrl, useCreateShare, usePeople, useUpdateShare } from '../api/shares';
import type { Share, ShareVisibility } from '../api/types';
import { copyText, isMobileDevice } from '../share/share';

const EXPIRY = [
  { value: 0, label: 'Never' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

interface FormValues {
  title: string;
  visibility: ShareVisibility;
  userIds: number[];
  expires: number;
}

type Props =
  | { photoIds: number[]; share?: undefined; onClose: () => void; onCreated?: (s: Share) => void }
  | { share: Share; photoIds?: undefined; onClose: () => void; onCreated?: undefined };

/**
 * Makes a share link from selected photos (or edits one): anyone with the link, or only chosen
 * people. After creating, shows the link ready to copy or send.
 */
export function ShareLinkModal({ photoIds, share, onClose, onCreated }: Props) {
  const { message } = App.useApp();
  const create = useCreateShare();
  const update = useUpdateShare();
  const people = usePeople();
  const [form] = Form.useForm<FormValues>();
  const visibility = Form.useWatch('visibility', form);
  const [made, setMade] = useState<Share | null>(null);
  const n = photoIds?.length ?? share?.photoCount ?? 0;
  const photos = `${n} photo${n === 1 ? '' : 's'}`;

  const submit = async () => {
    const v = await form.validateFields();
    const input = {
      title: v.title?.trim() || null,
      visibility: v.visibility,
      ...(v.visibility === 'private' && { userIds: v.userIds }),
    };
    try {
      if (share) {
        const days = v.expires === -1 ? undefined : v.expires || null;
        await update.mutateAsync({ id: share.id, ...input, ...(days !== undefined && { expiresInDays: days }) });
        message.success('Link updated');
        onClose();
      } else {
        const s = await create.mutateAsync({ ...input, photoIds: photoIds!, expiresInDays: v.expires || null });
        setMade(s);
        onCreated?.(s);
        if (await copyText(shareLinkUrl(s))) message.success('Link created and copied');
      }
    } catch (err) {
      message.error(errorMessage(err, share ? "Couldn't update the link" : "Couldn't create the link"));
    }
  };

  if (made) return <ShareReady share={made} onClose={onClose} />;

  return (
    <Modal
      open
      title={share ? 'Edit share link' : `Share ${photos}`}
      okText={share ? 'Save' : 'Create link'}
      onOk={submit}
      okButtonProps={{
        loading: create.isPending || update.isPending,
        icon: share ? undefined : <ShareAltOutlined aria-hidden />,
      }}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          title: share?.title ?? '',
          visibility: share?.visibility ?? 'public',
          userIds: share?.people?.map((u) => u.id) ?? [],
          expires: share ? -1 : 0,
        }}
      >
        <Form.Item name="title" label="Title (optional)">
          <Input maxLength={120} placeholder="e.g. For Mom & Dad" />
        </Form.Item>
        <Form.Item name="visibility" label="Who can open it">
          <Radio.Group>
            <Space direction="vertical">
              <Radio value="public">
                <GlobalOutlined aria-hidden /> Anyone with the link
              </Radio>
              <Radio value="private">
                <LockOutlined aria-hidden /> Only people I choose (they log in)
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        {visibility === 'private' && (
          <Form.Item
            name="userIds"
            label="People"
            rules={[{ required: true, type: 'array', min: 1, message: 'Choose at least one person' }]}
          >
            <Select
              mode="multiple"
              placeholder="Choose people"
              loading={people.isPending}
              optionFilterProp="label"
              options={(people.data ?? []).map((u) => ({ value: u.id, label: u.username }))}
              aria-label="People"
            />
          </Form.Item>
        )}
        <Form.Item name="expires" label="Link expires">
          <Select
            options={[
              ...(share
                ? [
                    {
                      value: -1,
                      label: share.expiresAt ? `Keep (${new Date(share.expiresAt).toLocaleDateString()})` : 'Keep (never)',
                    },
                  ]
                : []),
              ...EXPIRY,
            ]}
            aria-label="Link expires"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** The new link: copy it, send it (native share on phones) or open it. */
function ShareReady({ share, onClose }: { share: Share; onClose: () => void }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const url = shareLinkUrl(share);
  const n = share.photoCount;
  const copy = async () => message[(await copyText(url)) ? 'success' : 'error']('Link copied');
  const send = () =>
    navigator
      .share?.({ title: share.title ?? 'Pre-Wedding View', text: share.title ?? `${n} photos from our pre-wedding`, url })
      .catch(() => undefined);

  return (
    <Modal open title="Your link is ready" onCancel={onClose} footer={<Button onClick={onClose}>Done</Button>} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        {share.visibility === 'public'
          ? `Anyone with this link can see these ${n} photo${n === 1 ? '' : 's'}.`
          : `Only ${share.people?.map((u) => u.username).join(', ')} can open it, after logging in.`}
        {share.expiresAt && ` It stops working on ${new Date(share.expiresAt).toLocaleDateString()}.`}
      </Typography.Paragraph>
      <Space.Compact style={{ width: '100%' }}>
        <Input value={url} readOnly aria-label="Share link" onFocus={(e) => e.target.select()} />
        <Button type="primary" icon={<CopyOutlined aria-hidden />} onClick={copy}>
          Copy
        </Button>
      </Space.Compact>
      <Space style={{ marginTop: 12 }} wrap>
        {isMobileDevice() && typeof navigator.share === 'function' && (
          <Button icon={<ShareAltOutlined aria-hidden />} onClick={send}>
            Send…
          </Button>
        )}
        <Button
          onClick={() => {
            onClose();
            navigate(share.path);
          }}
        >
          Open link
        </Button>
        <Button
          type="link"
          onClick={() => {
            onClose();
            navigate('/shares');
          }}
        >
          Manage my links
        </Button>
      </Space>
    </Modal>
  );
}
