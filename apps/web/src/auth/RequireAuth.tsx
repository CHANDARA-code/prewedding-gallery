import { ReactNode } from 'react';
import { Button, Empty, Spin } from 'antd';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireAuth({ children, label }: { children: ReactNode; label: string }) {
  const { user, ready, openLogin } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div className="center-state">
        <Spin />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="center-state">
        <Empty description={`Log in to see your ${label}.`}>
          <Button type="primary" size="large" onClick={() => openLogin(location.pathname)}>
            Log in
          </Button>
        </Empty>
      </div>
    );
  }
  return <>{children}</>;
}
