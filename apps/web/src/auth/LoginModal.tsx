import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Modal, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import axios from 'axios';
import type { User } from '../api/types';
import { errorMessage } from '../api/client';

interface Values {
  username: string;
  password: string;
  remember: boolean;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onSubmit: (username: string, password: string, remember: boolean) => Promise<User>;
  onSuccess: (user: User) => void;
}

export function LoginModal({ open, onCancel, onSubmit, onSuccess }: Props) {
  const [form] = Form.useForm<Values>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFinish = async ({ username, password, remember }: Values) => {
    setError(null);
    setLoading(true);
    try {
      const user = await onSubmit(username.trim(), password, remember !== false);
      form.resetFields();
      onSuccess(user);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setError('Invalid username or password');
      } else {
        setError(errorMessage(err, 'Could not log in. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={<span className="serif-title">Welcome back</span>}
      onCancel={() => {
        setError(null);
        onCancel();
      }}
      footer={null}
      destroyOnHidden
      width={400}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark={false} autoComplete="on" initialValues={{ remember: true }}>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} role="alert" />}
        <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Enter your username' }]}>
          <Input prefix={<UserOutlined />} autoComplete="username" size="large" autoFocus />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}>
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
        </Form.Item>
        <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 16 }}>
          <Checkbox>Keep me signed in</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={loading}>
          Log in
        </Button>
        {import.meta.env.DEV && (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            Demo: demo / password
          </Typography.Paragraph>
        )}
      </Form>
    </Modal>
  );
}
