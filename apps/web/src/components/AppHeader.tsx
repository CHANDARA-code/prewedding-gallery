import { Button, Dropdown, FloatButton, Tag, Tooltip } from 'antd';
import { CloudUploadOutlined, LoginOutlined, LogoutOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useIsMobile } from '../hooks/useColumns';
import { UploadModal } from './UploadModal';

export function AppHeader() {
  const { user, isAdmin, can, ready, openLogin, logout } = useAuth();
  const canUpload = can('photos.upload');
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link to="/" className="brand" aria-label="Pre-Wedding View home">
          <span className="brand-mark" aria-hidden>
            ♡
          </span>
          <span className="brand-name">Pre-Wedding View</span>
        </Link>

        <div className="header-actions">
          {canUpload && !mobile && (
            <Button icon={<CloudUploadOutlined aria-hidden />} onClick={() => setUploadOpen(true)}>
              Upload
            </Button>
          )}

          {user ? (
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  ...(isAdmin ? [{ key: 'users', icon: <TeamOutlined />, label: 'Manage users' }] : []),
                  { key: 'logout', icon: <LogoutOutlined />, label: 'Log out' },
                ],
                onClick: ({ key }) => {
                  if (key === 'users') navigate('/users');
                  if (key === 'logout') logout();
                },
              }}
            >
              <Button type="text" className="user-button" icon={<UserOutlined />} aria-label={`Account menu for ${user.username}`}>
                {!mobile && <span className="user-name">{user.username}</span>}
                {isAdmin && (
                  <Tag color="magenta" className="admin-badge">
                    Admin
                  </Tag>
                )}
              </Button>
            </Dropdown>
          ) : mobile ? (
            <Tooltip title="Log in">
              <Button shape="circle" size="large" icon={<LoginOutlined />} aria-label="Log in" onClick={() => openLogin()} disabled={!ready} />
            </Tooltip>
          ) : (
            <Button type="primary" icon={<LoginOutlined aria-hidden />} onClick={() => openLogin()} disabled={!ready}>
              Log in
            </Button>
          )}
        </div>
      </div>

      {/* Portalled: the header's backdrop-filter would otherwise pin this "fixed" button to the header. */}
      {canUpload &&
        mobile &&
        createPortal(
          <FloatButton
            type="primary"
            icon={<CloudUploadOutlined />}
            tooltip="Upload photos"
            aria-label="Upload photos"
            onClick={() => setUploadOpen(true)}
            style={{ insetInlineEnd: 20, insetBlockEnd: 24, width: 52, height: 52 }}
          />,
          document.body,
        )}
      {canUpload && <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />}
    </header>
  );
}
