import { Tabs } from 'antd';
import { BookOutlined, HeartOutlined, PictureOutlined } from '@ant-design/icons';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppHeader } from './components/AppHeader';
import { AllPage } from './pages/AllPage';
import { FavoritePage } from './pages/FavoritePage';
import { SavePage } from './pages/SavePage';

const TABS = [
  { key: '/', label: 'All', icon: <PictureOutlined aria-hidden />, auth: false },
  { key: '/favorite', label: 'Favorite', icon: <HeartOutlined aria-hidden />, auth: true },
  { key: '/save', label: 'Save', icon: <BookOutlined aria-hidden />, auth: true },
];

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, ready, openLogin } = useAuth();
  const activeKey = TABS.some((t) => t.key === location.pathname) ? location.pathname : '/';

  const onTabChange = (key: string) => {
    const tab = TABS.find((t) => t.key === key);
    // A guest clicking Favorite or Save gets the login modal, then lands on that tab.
    if (tab?.auth && ready && !user) {
      openLogin(key);
      return;
    }
    navigate(key);
  };

  return (
    <div className="app">
      <AppHeader />
      <nav className="tab-bar" aria-label="Gallery sections">
        <Tabs
          centered
          activeKey={activeKey}
          onChange={onTabChange}
          items={TABS.map((t) => ({
            key: t.key,
            label: (
              <span className="tab-label">
                {t.icon}
                <span>{t.label}</span>
              </span>
            ),
          }))}
        />
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<AllPage />} />
          <Route path="/favorite" element={<FavoritePage />} />
          <Route path="/save" element={<SavePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
