import { Tabs } from 'antd';
import { BookOutlined, FolderOutlined, HeartOutlined, PictureOutlined } from '@ant-design/icons';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppHeader } from './components/AppHeader';
import { AllPage } from './pages/AllPage';
import { AlbumsPage } from './pages/AlbumsPage';
import { AlbumPage } from './pages/AlbumPage';
import { FavoritePage } from './pages/FavoritePage';
import { SavePage } from './pages/SavePage';
import { UsersPage } from './pages/UsersPage';
import { SharePage } from './pages/SharePage';
import { SharesPage } from './pages/SharesPage';

const TABS = [
  { key: '/', label: 'All', icon: <PictureOutlined aria-hidden />, auth: false },
  { key: '/albums', label: 'Albums', icon: <FolderOutlined aria-hidden />, auth: false },
  { key: '/favorite', label: 'Favorite', icon: <HeartOutlined aria-hidden />, auth: true },
  { key: '/save', label: 'Save', icon: <BookOutlined aria-hidden />, auth: true },
];

/** Shared links (/photo/:id, which the server decorates with Open Graph tags) open the viewer on All. */
function SharedPhoto() {
  const { id } = useParams();
  return <Navigate to={/^\d+$/.test(id ?? '') ? `/?photo=${id}` : '/'} replace />;
}

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, ready, openLogin } = useAuth();
  // /users, /shares and share links (/s/...) are not tabs, so no tab is highlighted there.
  const activeKey = location.pathname.startsWith('/albums/')
    ? '/albums'
    : TABS.some((t) => t.key === location.pathname)
      ? location.pathname
      : location.pathname === '/users' || location.pathname === '/shares' || location.pathname.startsWith('/s/')
        ? ''
        : '/';

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
          // Inside an album the Albums tab is already active: clicking it goes back to the album list.
          onTabClick={(key) => key === activeKey && key !== location.pathname && navigate(key)}
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
          <Route path="/albums" element={<AlbumsPage />} />
          <Route path="/albums/:slug" element={<AlbumPage />} />
          <Route path="/favorite" element={<FavoritePage />} />
          <Route path="/save" element={<SavePage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/shares" element={<SharesPage />} />
          <Route path="/s/:token" element={<SharePage />} />
          <Route path="/photo/:id" element={<SharedPhoto />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
