import { useState } from 'react';
import { App, Button, Form, Input, Modal, Progress, Result, Upload } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useUpload } from '../api/photos';
import { errorMessage } from '../api/client';

const MAX_MB = 15;
const MAX_FILES = 20;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function UploadModal({ open, onClose }: Props) {
  const { message } = App.useApp();
  const upload = useUpload();
  const [form] = Form.useForm<{ title?: string; caption?: string }>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<number | null>(null);

  const reset = () => {
    setFileList([]);
    setProgress(0);
    setDone(null);
    form.resetFields();
    upload.reset();
  };

  const close = () => {
    if (upload.isPending) return;
    reset();
    onClose();
  };

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (!ACCEPT.includes(file.type)) {
      message.error(`${file.name}: only JPG, PNG or WebP images are allowed`);
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      message.error(`${file.name}: larger than ${MAX_MB} MB`);
      return Upload.LIST_IGNORE;
    }
    if (fileList.length >= MAX_FILES) {
      message.warning(`Up to ${MAX_FILES} photos per upload`);
      return Upload.LIST_IGNORE;
    }
    setFileList((prev) => [...prev, { uid: file.uid, name: file.name, size: file.size, type: file.type, originFileObj: file, status: 'done' }]);
    return false; // upload manually on submit
  };

  const submit = async () => {
    const values = await form.validateFields();
    const files = fileList.map((f) => f.originFileObj).filter((f): f is NonNullable<typeof f> => Boolean(f));
    if (!files.length) {
      message.warning('Choose at least one photo');
      return;
    }
    setProgress(0);
    try {
      const created = await upload.mutateAsync({
        files,
        title: values.title?.trim() || undefined,
        caption: values.caption?.trim() || undefined,
        onProgress: setProgress,
      });
      setDone(created.length);
    } catch (err) {
      message.error(errorMessage(err, 'Upload failed'));
    }
  };

  return (
    <Modal
      open={open}
      title="Upload photos"
      onCancel={close}
      maskClosable={!upload.isPending}
      footer={
        done !== null
          ? [
              <Button key="more" onClick={reset}>
                Upload more
              </Button>,
              <Button key="close" type="primary" onClick={close}>
                Done
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={close} disabled={upload.isPending}>
                Cancel
              </Button>,
              <Button key="submit" type="primary" onClick={submit} loading={upload.isPending} disabled={!fileList.length}>
                Upload {fileList.length ? `${fileList.length} photo${fileList.length > 1 ? 's' : ''}` : ''}
              </Button>,
            ]
      }
    >
      {done !== null ? (
        <Result status="success" title={`${done} photo${done === 1 ? '' : 's'} uploaded`} subTitle="They now appear at the top of the gallery." />
      ) : (
        <>
          <Upload.Dragger
            multiple
            accept=".jpg,.jpeg,.png,.webp"
            fileList={fileList}
            beforeUpload={beforeUpload}
            onRemove={(file) => setFileList((prev) => prev.filter((f) => f.uid !== file.uid))}
            disabled={upload.isPending}
            listType="picture"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag photos here</p>
            <p className="ant-upload-hint">JPG, PNG or WebP · up to {MAX_MB} MB each · {MAX_FILES} per upload</p>
          </Upload.Dragger>
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item name="title" label="Title (optional, applied to each photo)" rules={[{ max: 200 }]}>
              <Input maxLength={200} disabled={upload.isPending} />
            </Form.Item>
            <Form.Item name="caption" label="Caption (optional)" rules={[{ max: 1000 }]}>
              <Input.TextArea maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} disabled={upload.isPending} />
            </Form.Item>
          </Form>
          {upload.isPending && <Progress percent={progress} status="active" />}
        </>
      )}
    </Modal>
  );
}
