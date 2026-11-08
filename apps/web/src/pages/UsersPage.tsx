import { useState } from 'react';
import { Alert, App, Button, Checkbox, Dropdown, Empty, Form, Input, Modal, Radio, Result, Segmented, Skeleton, Tag, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  CopyOutlined,
  CrownOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  KeyOutlined,
  MoreOutlined,
  StopOutlined,
  UserAddOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';
import { copyText } from '../share/share';
import {
  useCreateUser,
  useDeleteUser,
  usePermissionCatalogue,
  useResetPassword,
  useUpdateUser,
  useUsers,
} from '../api/users';
import type { ManagedUser, Permission, PermissionInfo, Role } from '../api/types';

/** Short labels for tags; the catalogue's long labels go in the form. */
const SHORT: Record<Permission, string> = {
  'photos.upload': 'Upload',
  'photos.edit': 'Edit & rotate',
  'photos.delete': 'Trash & restore',
  'photos.purge': 'Delete forever',
  'photos.export': 'Export CSV',
  'users.manage': 'Manage users',
};

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return 'just now';
}

interface Credentials {
  username: string;
  password: string;
  title: string;
}

export function UsersPage() {
  const { user, isAdmin, ready } = useAuth();
  const users = useUsers();
  const catalogue = usePermissionCatalogue();
  const [editing, setEditing] = useState<ManagedUser | 'new' | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  if (!ready) return <Skeleton active />;
  if (!user) return <Navigate to="/" replace />;
  if (!isAdmin) return <Result status="403" title="Admins only" subTitle="Only admins can manage users." />;

  const list = users.data ?? [];
  const activeAdmins = list.filter((u) => u.role === 'admin' && !u.disabled).length;

  return (
    <section className="users-page" aria-labelledby="users-title">
      <div className="users-head">
        <div>
          <h1 id="users-title" className="serif-title users-title">
            Users
          </h1>
          <p className="users-sub">
            {list.length ? `${list.length} accounts · ${activeAdmins} active admin${activeAdmins === 1 ? '' : 's'}` : 'Accounts, roles and what each can do'}
          </p>
        </div>
        <Button type="primary" icon={<UserAddOutlined aria-hidden />} onClick={() => setEditing('new')}>
          Add user
        </Button>
      </div>

      <p className="users-note">
        Everyone signed in can view, favorite, save, share and download. <b>Admins</b> can do everything. A <b>user</b> can be given extra actions below.
      </p>

      {users.isError ? (
        <Result status="error" title="Couldn't load users" subTitle={errorMessage(users.error)} extra={<Button onClick={() => users.refetch()}>Retry</Button>} />
      ) : users.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : list.length === 0 ? (
        <Empty description="No users yet" />
      ) : (
        <ul className="user-list" aria-label="Users">
          {list.map((u) => (
            <UserRow
              key={u.id}
              u={u}
              self={u.id === user.id}
              lastAdmin={u.role === 'admin' && !u.disabled && activeAdmins <= 1}
              onEdit={() => setEditing(u)}
              onPassword={(password) => setCredentials({ username: u.username, password, title: `New password for ${u.username}` })}
            />
          ))}
        </ul>
      )}

      {editing && (
        <UserForm
          user={editing === 'new' ? null : editing}
          self={editing !== 'new' && editing.id === user.id}
          catalogue={catalogue.data ?? []}
          onClose={() => setEditing(null)}
          onCreated={(username, password) => password && setCredentials({ username, password, title: `${username} is ready` })}
        />
      )}
      {credentials && <CredentialsModal {...credentials} onClose={() => setCredentials(null)} />}
    </section>
  );
}

function UserRow({
  u,
  self,
  lastAdmin,
  onEdit,
  onPassword,
}: {
  u: ManagedUser;
  self: boolean;
  lastAdmin: boolean;
  onEdit: () => void;
  onPassword: (password: string) => void;
}) {
  const { message, modal } = App.useApp();
  const update = useUpdateUser();
  const reset = useResetPassword();
  const remove = useDeleteUser();

  const confirmReset = () =>
    modal.confirm({
      title: `Reset ${u.username}'s password?`,
      icon: <KeyOutlined />,
      content: 'A new strong password is generated and shown once. They are signed out on every device.',
      okText: 'Reset password',
      onOk: () =>
        reset
          .mutateAsync({ id: u.id })
          .then((r) => r.generatedPassword && onPassword(r.generatedPassword))
          .catch((err) => message.error(errorMessage(err, "Couldn't reset the password"))),
    });

  const toggleDisabled = () => {
    const disabling = !u.disabled;
    const run = () =>
      update
        .mutateAsync({ id: u.id, disabled: disabling })
        .then(() => message.success(disabling ? `${u.username} disabled and signed out` : `${u.username} can log in again`))
        .catch((err) => message.error(errorMessage(err, "Couldn't update the user")));
    if (!disabling) return run();
    modal.confirm({
      title: `Disable ${u.username}?`,
      icon: <StopOutlined />,
      content: 'They are signed out everywhere and cannot log in until you enable the account again. Nothing is deleted.',
      okText: 'Disable',
      okButtonProps: { danger: true },
      onOk: run,
    });
  };

  const confirmDelete = () =>
    modal.confirm({
      title: `Delete ${u.username}?`,
      icon: <ExclamationCircleFilled />,
      content: u.photosUploaded
        ? `${u.username} uploaded ${u.photosUploaded} photo(s), so the account can only be disabled.`
        : 'Deletes the account with its favorites and saves. This cannot be undone.',
      okText: 'Delete user',
      okButtonProps: { danger: true, disabled: u.photosUploaded > 0 },
      onOk: () =>
        remove
          .mutateAsync(u.id)
          .then(() => message.success(`Deleted ${u.username}`))
          .catch((err) => message.error(errorMessage(err, "Couldn't delete the user"))),
    });

  const locked = self || lastAdmin;
  const lockedWhy = self ? "You can't do this to your own account" : 'This is the last active admin';
  const items: MenuProps['items'] = [
    { key: 'edit', icon: <EditOutlined />, label: 'Edit role & permissions' },
    { key: 'password', icon: <KeyOutlined />, label: 'Reset password' },
    {
      key: 'toggle',
      icon: u.disabled ? <CheckCircleOutlined /> : <StopOutlined />,
      label: u.disabled ? 'Enable account' : locked ? <Tooltip title={lockedWhy}>Disable account</Tooltip> : 'Disable account',
      disabled: !u.disabled && locked,
    },
    { type: 'divider' },
    { key: 'delete', icon: <DeleteOutlined />, label: locked ? <Tooltip title={lockedWhy}>Delete user</Tooltip> : 'Delete user', danger: true, disabled: locked },
  ];
  const onMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'edit') onEdit();
    if (key === 'password') confirmReset();
    if (key === 'toggle') toggleDisabled();
    if (key === 'delete') confirmDelete();
  };

  return (
    <li className={`user-row${u.disabled ? ' is-disabled' : ''}`} aria-label={u.username}>
      <span className={`user-avatar${u.role === 'admin' ? ' is-admin' : ''}`} aria-hidden>
        {u.username.slice(0, 1).toUpperCase()}
      </span>
      <div className="user-main">
        <div className="user-line">
          <span className="user-handle">{u.username}</span>
          {u.role === 'admin' ? (
            <Tag color="magenta" icon={<CrownOutlined />}>
              Admin
            </Tag>
          ) : (
            <Tag>User</Tag>
          )}
          {self && <Tag color="blue">You</Tag>}
          {u.disabled && <Tag color="default">Disabled</Tag>}
        </div>
        <div className="user-perms">
          {u.role === 'admin' ? (
            <span className="user-perm-all">All permissions</span>
          ) : u.grants.length ? (
            u.grants.map((p) => (
              <Tag key={p} bordered={false} color="pink">
                {SHORT[p]}
              </Tag>
            ))
          ) : (
            <span className="user-perm-all">View, favorite, save, share</span>
          )}
        </div>
        <div className="user-meta">
          Last login {relative(u.lastLoginAt)}
          {u.photosUploaded ? ` · ${u.photosUploaded} upload${u.photosUploaded === 1 ? '' : 's'}` : ''}
        </div>
      </div>
      <div className="user-actions">
        <Tooltip title="Edit role & permissions">
          <Button type="text" icon={<EditOutlined />} aria-label={`Edit ${u.username}`} onClick={onEdit} />
        </Tooltip>
        <Dropdown menu={{ items, onClick: onMenu }} trigger={['click']} placement="bottomRight">
          <Button type="text" icon={<MoreOutlined />} aria-label={`More actions for ${u.username}`} />
        </Dropdown>
      </div>
    </li>
  );
}

interface FormValues {
  username: string;
  role: Role;
  grants: Permission[];
  passwordMode: 'generate' | 'set';
  password?: string;
}

function UserForm({
  user,
  self,
  catalogue,
  onClose,
  onCreated,
}: {
  user: ManagedUser | null;
  self: boolean;
  catalogue: PermissionInfo[];
  onClose: () => void;
  onCreated: (username: string, password?: string) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const create = useCreateUser();
  const update = useUpdateUser();
  const role = Form.useWatch('role', form) ?? user?.role ?? 'user';
  const passwordMode = Form.useWatch('passwordMode', form) ?? 'generate';
  const grantable = catalogue.filter((p) => p.grantable);
  const isNew = !user;

  const submit = async () => {
    const v = await form.validateFields();
    try {
      if (isNew) {
        const r = await create.mutateAsync({
          username: v.username.trim().toLowerCase(),
          role: v.role,
          grants: v.role === 'admin' ? [] : v.grants ?? [],
          password: v.passwordMode === 'set' ? v.password : undefined,
        });
        message.success(`Created ${r.user.username}`);
        onCreated(r.user.username, r.generatedPassword ?? undefined);
      } else {
        await update.mutateAsync({ id: user.id, role: v.role, grants: v.role === 'admin' ? user.grants : v.grants ?? [] });
        message.success(`Updated ${user.username}`);
      }
      onClose();
    } catch (err) {
      message.error(errorMessage(err, isNew ? "Couldn't create the user" : "Couldn't update the user"));
    }
  };

  return (
    <Modal
      open
      title={isNew ? 'Add user' : `Edit ${user.username}`}
      okText={isNew ? 'Create user' : 'Save changes'}
      confirmLoading={create.isPending || update.isPending}
      onOk={submit}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ username: '', role: user?.role ?? 'user', grants: user?.grants ?? [], passwordMode: 'generate' }}
        onFinish={submit}
      >
        {isNew && (
          <Form.Item
            name="username"
            label="Username"
            normalize={(v: string) => v.toLowerCase().replace(/\s/g, '')}
            rules={[
              { required: true, message: 'Pick a username' },
              { pattern: /^[a-z0-9][a-z0-9._-]{1,31}$/, message: '2-32 letters, digits, dot, dash or underscore' },
            ]}
          >
            <Input autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="e.g. dara" />
          </Form.Item>
        )}

        <Form.Item name="role" label="Role">
          <Segmented<Role>
            block
            disabled={self}
            options={[
              { value: 'user', label: 'User' },
              { value: 'admin', label: 'Admin' },
            ]}
          />
        </Form.Item>
        {self && <p className="form-hint">You can't change your own role. Ask another admin.</p>}

        {/* Admins: everything, shown read-only (unnamed so it never overwrites the stored grants). */}
        {role === 'admin' ? (
          <Form.Item label="Permissions" extra="Admins can do everything, including managing users.">
            <Checkbox.Group className="perm-group" value={catalogue.map((p) => p.key)} disabled options={catalogue.map((p) => ({ value: p.key, label: p.label }))} />
          </Form.Item>
        ) : (
          <Form.Item name="grants" label="Permissions" extra="Viewing, favorites, saves and sharing need no permission.">
            <Checkbox.Group className="perm-group" options={grantable.map((p) => ({ value: p.key, label: p.label }))} />
          </Form.Item>
        )}

        {isNew && (
          <>
            <Form.Item name="passwordMode" label="Password">
              <Radio.Group
                options={[
                  { value: 'generate', label: 'Generate a strong one' },
                  { value: 'set', label: 'Set it myself' },
                ]}
              />
            </Form.Item>
            {passwordMode === 'set' && (
              <Form.Item name="password" rules={[{ required: true, message: 'Enter a password' }, { min: 8, max: 128, message: '8-128 characters' }]}>
                <Input.Password autoComplete="new-password" placeholder="At least 8 characters" />
              </Form.Item>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
}

function CredentialsModal({ username, password, title, onClose }: Credentials & { onClose: () => void }) {
  const { message } = App.useApp();
  const login = `${window.location.origin}\nUsername: ${username}\nPassword: ${password}`;
  const copy = async (text: string, what: string) => message[(await copyText(text)) ? 'success' : 'error'](`${what} copied`);
  return (
    <Modal
      open
      title={title}
      onCancel={onClose}
      footer={[
        <Button key="copy" icon={<CopyOutlined />} onClick={() => copy(login, 'Login details')}>
          Copy login details
        </Button>,
        <Button key="done" type="primary" onClick={onClose}>
          Done
        </Button>,
      ]}
    >
      <Alert type="warning" showIcon message="This password is shown only once. Copy it now and send it privately." style={{ marginBottom: 16 }} />
      <dl className="cred-list">
        <dt>Username</dt>
        <dd>
          <Typography.Text code>{username}</Typography.Text>
        </dd>
        <dt>Password</dt>
        <dd>
          <Typography.Text code className="cred-password">
            {password}
          </Typography.Text>
          <Tooltip title="Copy password">
            <Button size="small" type="text" icon={<CopyOutlined />} aria-label="Copy password" onClick={() => copy(password, 'Password')} />
          </Tooltip>
        </dd>
      </dl>
    </Modal>
  );
}
