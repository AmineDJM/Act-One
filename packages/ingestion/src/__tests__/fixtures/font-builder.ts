/**
 * Minimal sfnt files built byte by byte, so the reader is tested against
 * tables whose every field is known — including the ones real fonts in the
 * repository never exercise: a restricted fsType, a proprietary licence,
 * variable axes.
 */
export type NameRecord = { id: number; value: string; platform?: 1 | 3 };

export function nameTable(records: NameRecord[]): Buffer {
  const encoded = records.map((record) => {
    if (record.platform === 1) return { record, bytes: Buffer.from(record.value, 'latin1') };
    const bytes = Buffer.from(record.value, 'utf16le');
    bytes.swap16();
    return { record, bytes };
  });
  const header = Buffer.alloc(6 + encoded.length * 12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(encoded.length, 2);
  header.writeUInt16BE(header.length, 4);
  let offset = 0;
  encoded.forEach(({ record, bytes }, index) => {
    const at = 6 + index * 12;
    const mac = record.platform === 1;
    header.writeUInt16BE(mac ? 1 : 3, at);
    header.writeUInt16BE(mac ? 0 : 1, at + 2);
    header.writeUInt16BE(mac ? 0 : 0x0409, at + 4);
    header.writeUInt16BE(record.id, at + 6);
    header.writeUInt16BE(bytes.length, at + 8);
    header.writeUInt16BE(offset, at + 10);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...encoded.map(({ bytes }) => bytes)]);
}

export function os2Table(options: { weight: number; width?: number; fsType: number; vendor?: string }): Buffer {
  const table = Buffer.alloc(78);
  table.writeUInt16BE(4, 0);
  table.writeUInt16BE(options.weight, 4);
  table.writeUInt16BE(options.width ?? 5, 6);
  table.writeUInt16BE(options.fsType, 8);
  table.write((options.vendor ?? 'ACME').padEnd(4, ' ').slice(0, 4), 58, 'latin1');
  return table;
}

export function fvarTable(axes: { tag: string; min: number; def: number; max: number }[]): Buffer {
  const table = Buffer.alloc(16 + axes.length * 20);
  table.writeUInt16BE(1, 0);
  table.writeUInt16BE(0, 2);
  table.writeUInt16BE(16, 4);
  table.writeUInt16BE(2, 6);
  table.writeUInt16BE(axes.length, 8);
  table.writeUInt16BE(20, 10);
  axes.forEach((axis, index) => {
    const at = 16 + index * 20;
    table.write(axis.tag.padEnd(4, ' '), at, 'latin1');
    table.writeInt32BE(Math.round(axis.min * 65536), at + 4);
    table.writeInt32BE(Math.round(axis.def * 65536), at + 8);
    table.writeInt32BE(Math.round(axis.max * 65536), at + 12);
  });
  return table;
}

export function sfnt(tables: Record<string, Buffer>, signature: 'truetype' | 'opentype' = 'truetype'): Buffer {
  const tags = Object.keys(tables).sort();
  const directory = Buffer.alloc(12 + tags.length * 16);
  if (signature === 'opentype') directory.write('OTTO', 0, 'latin1');
  else directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(tags.length, 4);
  let offset = directory.length;
  const bodies: Buffer[] = [];
  tags.forEach((tag, index) => {
    const body = tables[tag]!;
    const padded = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
    const at = 12 + index * 16;
    directory.write(tag, at, 'latin1');
    directory.writeUInt32BE(0, at + 4);
    directory.writeUInt32BE(offset, at + 8);
    directory.writeUInt32BE(body.length, at + 12);
    offset += padded.length;
    bodies.push(padded);
  });
  return Buffer.concat([directory, ...bodies]);
}
