import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { once } from 'events';
import { crc32 } from 'zlib';
import type { Writable } from 'stream';

export interface ZipEntry {
  /** File name inside the archive (ASCII or UTF-8). */
  name: string;
  path: string;
}

/** ZIP without ZIP64: every size and offset must fit in 32 bits. */
export const ZIP_MAX_BYTES = 0xffff_fff0;

const LOCAL = 30;
const DESCRIPTOR = 16;
const CENTRAL = 46;
const END = 22;
// Bit 3: sizes and CRC follow the data (so it streams in one pass). Bit 11: names are UTF-8.
const FLAGS = 0x0808;

function dosDateTime(d: Date): [number, number] {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

export interface PreparedZip {
  entries: (ZipEntry & { size: number; nameBytes: Buffer })[];
  /** Exact archive size, so the download can show progress. */
  totalBytes: number;
}

/** Stats every file up front: the exact Content-Length, and an early 4 GB check. Missing files are dropped. */
export async function prepareZip(entries: ZipEntry[]): Promise<PreparedZip> {
  const out: PreparedZip['entries'] = [];
  for (const e of entries) {
    const s = await stat(e.path).catch(() => null);
    if (s?.isFile()) out.push({ ...e, size: s.size, nameBytes: Buffer.from(e.name, 'utf8') });
  }
  const totalBytes = out.reduce((n, e) => n + LOCAL + e.nameBytes.length + e.size + DESCRIPTOR + CENTRAL + e.nameBytes.length, END);
  return { entries: out, totalBytes };
}

/**
 * Writes a stored (uncompressed) ZIP of `zip.entries` to `out`, honouring backpressure. Photos are already
 * compressed, so deflate would only cost CPU. Stops quietly if the client goes away.
 */
export async function writeZip(zip: PreparedZip, out: Writable): Promise<void> {
  const [time, date] = dosDateTime(new Date());
  const central: Buffer[] = [];
  let offset = 0;

  const write = async (buf: Buffer) => {
    offset += buf.length;
    if (out.write(buf)) return;
    // Wait for drain, or for the client to go away; either way drop both listeners afterwards.
    const ac = new AbortController();
    await Promise.race([once(out, 'drain', { signal: ac.signal }), once(out, 'close', { signal: ac.signal })]).catch(() => undefined);
    ac.abort();
  };

  for (const e of zip.entries) {
    if (out.destroyed) return;
    const start = offset;
    const local = Buffer.alloc(LOCAL);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // CRC and sizes (14..25) are zero here and given in the data descriptor.
    local.writeUInt16LE(e.nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    await write(Buffer.concat([local, e.nameBytes]));

    let crc = 0;
    let size = 0;
    for await (const chunk of createReadStream(e.path)) {
      if (out.destroyed) return;
      const buf = chunk as Buffer;
      crc = crc32(buf, crc);
      size += buf.length;
      await write(buf);
    }
    if (size !== e.size) throw new Error(`${e.name} changed size while zipping`);

    const desc = Buffer.alloc(DESCRIPTOR);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(size, 8);
    desc.writeUInt32LE(size, 12);
    await write(desc);

    const c = Buffer.alloc(CENTRAL);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(FLAGS, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(size, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(e.nameBytes.length, 28);
    // extra, comment, disk, internal attrs, external attrs: 0
    c.writeUInt32LE(start, 42);
    central.push(c, e.nameBytes);
  }

  const cdStart = offset;
  const cd = Buffer.concat(central);
  await write(cd);
  const end = Buffer.alloc(END);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip.entries.length, 8);
  end.writeUInt16LE(zip.entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(cdStart, 16);
  await write(end);
}
