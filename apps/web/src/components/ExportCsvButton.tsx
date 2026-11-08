import { useState } from 'react';
import { App, Dropdown } from 'antd';
import { DownOutlined, FileExcelOutlined } from '@ant-design/icons';
import { CsvExport, downloadPhotosCsv } from '../api/photos';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export interface ExportChoice extends CsvExport {
  key: string;
  label: string;
}

/**
 * "Export CSV" for accounts with photos.export. The main button downloads `main`; the arrow offers
 * the other choices. Every CSV starts with source zip, original file name, detail link and who
 * favorited/saved each photo.
 */
export function ExportCsvButton({ main, more = [] }: { main: ExportChoice; more?: ExportChoice[] }) {
  const { can } = useAuth();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  if (!can('photos.export')) return null;

  const run = async (choice: ExportChoice) => {
    setBusy(true);
    const done = message.loading(`Preparing ${choice.label.toLowerCase()}…`, 0);
    try {
      const name = await downloadPhotosCsv(choice);
      message.success(`Downloaded ${name}`);
    } catch (err) {
      message.error(errorMessage(err, "Couldn't export the CSV"));
    } finally {
      done();
      setBusy(false);
    }
  };

  return (
    <Dropdown.Button
      loading={busy}
      onClick={() => run(main)}
      icon={<DownOutlined aria-label="More export options" />}
      menu={{
        items: [main, ...more].map((c) => ({ key: c.key, label: c.label, icon: <FileExcelOutlined /> })),
        onClick: ({ key }) => {
          const c = [main, ...more].find((x) => x.key === key);
          if (c) run(c);
        },
      }}
      title="CSV: source zip, original file name, detail link, favorites/saves and who picked them"
    >
      <FileExcelOutlined aria-hidden /> Export CSV
    </Dropdown.Button>
  );
}
