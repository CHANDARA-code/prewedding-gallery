import { useState } from 'react';
import { Segmented } from 'antd';
import type { AdminStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { emptyStates, GalleryView } from '../components/GalleryView';

// Survives tab switches (the page unmounts) without putting it in the URL.
let lastAdminStatus: AdminStatus = 'active';

export function AllPage() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState<AdminStatus>(lastAdminStatus);

  if (!isAdmin) return <GalleryView scope="all" empty={emptyStates.all} />;

  return (
    <>
      <div className="admin-filter">
        <Segmented<AdminStatus>
          value={status}
          onChange={(v) => {
            lastAdminStatus = v;
            setStatus(v);
            window.scrollTo({ top: 0 });
          }}
          options={[
            { label: 'Active', value: 'active' },
            { label: 'Trash', value: 'deleted' },
            { label: 'All', value: 'all' },
          ]}
          aria-label="Photo status filter"
        />
      </div>
      <GalleryView
        key={status}
        scope="admin"
        status={status}
        empty={status === 'deleted' ? emptyStates.trash : emptyStates.all}
      />
    </>
  );
}
