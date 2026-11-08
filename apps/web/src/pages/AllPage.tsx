import { useState } from 'react';
import { App, Button, Segmented, Tooltip } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import { downloadPhotosCsv } from '../api/photos';
import { errorMessage } from '../api/client';
import type { AdminStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { emptyStates, GalleryView } from '../components/GalleryView';

// Survives tab switches (the page unmounts) without putting it in the URL.
let lastAdminStatus: AdminStatus = 'active';

export function AllPage() {
  const { can } = useAuth();
  const seesTrash = can('photos.delete');
  const canExport = can('photos.export');
  const { message } = App.useApp();
  const [status, setStatus] = useState<AdminStatus>(lastAdminStatus);
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const name = await downloadPhotosCsv(status);
      message.success(`Downloaded ${name}`);
    } catch (err) {
      message.error(errorMessage(err, "Couldn't export the CSV"));
    } finally {
      setExporting(false);
    }
  };

  if (!seesTrash && !canExport) return <GalleryView scope="all" empty={emptyStates.all} />;

  const exportButton = canExport && (
    <Tooltip title="CSV with original file names, sizes, camera data and favorite/save counts for the photos in this filter">
      <Button icon={<FileExcelOutlined aria-hidden />} onClick={exportCsv} loading={exporting}>
        Export CSV
      </Button>
    </Tooltip>
  );

  // Export only (no trash access): the normal gallery plus the export button.
  if (!seesTrash)
    return (
      <>
        <div className="admin-filter">{exportButton}</div>
        <GalleryView scope="all" empty={emptyStates.all} />
      </>
    );

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
        {exportButton}
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
