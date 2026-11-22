import { deflateRawSync, gzipSync } from 'node:zlib';
import {
  extractTarGzBuffer,
  extractZipBuffer,
  sanitizeArchiveEntryPath,
} from '@/settings/plugins/safe-archive.util';

function buildTestZip(
  entries: {
    name: string;
    content: Buffer;
    method?: 0 | 8;
    externalAttrs?: number;
    declaredUncompressedSize?: number;
  }[],
): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 8;
    const compressed =
      method === 0 ? entry.content : deflateRawSync(entry.content);
    const uncompressedLen =
      entry.declaredUncompressedSize ?? entry.content.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(uncompressedLen, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // Unix host
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressedLen, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((entry.externalAttrs ?? 0) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

function buildTestTarGz(
  entries: { name: string; content: Buffer; typeflag?: string }[],
): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, Math.min(100, entry.name.length), 'utf8');
    header.write('0000644\0', 100, 8, 'utf8');
    header.write('0000000\0', 108, 8, 'utf8');
    header.write('0000000\0', 116, 8, 'utf8');
    const sizeOctal = `${entry.content.length.toString(8).padStart(11, '0')}\0`;
    header.write(sizeOctal, 124, 12, 'utf8');
    header.write('00000000000\0', 136, 12, 'utf8');
    header.fill(32, 148, 156);
    header.write(entry.typeflag ?? '0', 156, 1, 'utf8');
    header.write('ustar\0', 257, 6, 'utf8');
    header.write('00', 263, 2, 'utf8');

    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');

    blocks.push(header);
    if (entry.content.length > 0) {
      const rem = entry.content.length % 512;
      const padded =
        rem === 0
          ? entry.content
          : Buffer.concat([entry.content, Buffer.alloc(512 - rem)]);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe('safe-archive.util', () => {
  it.each([extractZipBuffer, extractTarGzBuffer])(
    'rejects non-Buffer input before reading the archive (%p)',
    (extract) => {
      const input = {
        get length(): number {
          throw new Error('must not inspect non-Buffer input');
        },
      };
      expect(() => extract(input)).toThrow(/must be a Buffer/);
    },
  );

  it('extracts valid ZIP and TAR.GZ archives and strips single root wrapper dir', () => {
    const zip = buildTestZip([
      { name: 'cool-wallpaper-main/project.json', content: Buffer.from('{}') },
      {
        name: 'cool-wallpaper-main/index.html',
        content: Buffer.from('<h1>Hi</h1>'),
        method: 0,
      },
    ]);
    const zipFiles = extractZipBuffer(zip);
    expect(zipFiles.map((f) => f.relativePath)).toEqual([
      'project.json',
      'index.html',
    ]);

    const tgz = buildTestTarGz([
      { name: 'package/package.json', content: Buffer.from('{"name":"x"}') },
      { name: 'package/dist/bg.html', content: Buffer.from('<canvas/>') },
    ]);
    const tgzFiles = extractTarGzBuffer(tgz);
    expect(tgzFiles.map((f) => f.relativePath)).toEqual([
      'package.json',
      'dist/bg.html',
    ]);
  });

  it('blocks Zip Slip traversal, drive letters, symlinks, reserved names, and ratio bombs', () => {
    expect(() => sanitizeArchiveEntryPath('../evil.txt')).toThrow(/traversal/);
    expect(() => sanitizeArchiveEntryPath('C:\\Windows\\x.txt')).toThrow(
      /drive path/,
    );
    expect(() => sanitizeArchiveEntryPath('./C:/evil.txt')).toThrow(/colon/);
    expect(() => sanitizeArchiveEntryPath('sub/file.txt:stream')).toThrow(
      /colon/,
    );
    expect(() => sanitizeArchiveEntryPath('sub/CON.txt')).toThrow(/reserved/);
    expect(() => sanitizeArchiveEntryPath('sub/name.')).toThrow(/trailing/);

    const slipZip = buildTestZip([
      { name: '../../escape.html', content: Buffer.from('x') },
    ]);
    expect(() => extractZipBuffer(slipZip)).toThrow(/traversal/);

    const symlinkZip = buildTestZip([
      {
        name: 'link-to-secret',
        content: Buffer.from('/etc/passwd'),
        externalAttrs: (0o120777 << 16) >>> 0,
      },
    ]);
    expect(() => extractZipBuffer(symlinkZip)).toThrow(/symbolic link/);

    const bigZero = Buffer.alloc(1024 * 1024, 0);
    const bombZip = buildTestZip([{ name: 'bomb.txt', content: bigZero }]);
    expect(() => extractZipBuffer(bombZip)).toThrow(/compression ratio/);

    const symlinkTgz = buildTestTarGz([
      { name: 'pkg/link', content: Buffer.alloc(0), typeflag: '2' },
    ]);
    expect(() => extractTarGzBuffer(symlinkTgz)).toThrow(/forbidden link/);
  });
});
