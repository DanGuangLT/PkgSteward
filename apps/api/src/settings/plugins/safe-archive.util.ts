import { gunzipSync, inflateRawSync } from 'node:zlib';

export const MAX_PLUGIN_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const MAX_PLUGIN_UNCOMPRESSED_BYTES = 35 * 1024 * 1024;
export const MAX_PLUGIN_FILES = 200;
export const MAX_COMPRESSION_RATIO = 100;

export interface IExtractedArchiveFile {
  relativePath: string;
  content: Buffer;
}

const WINDOWS_RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export function sanitizeArchiveEntryPath(rawPath: string): string {
  if (typeof rawPath !== 'string' || rawPath.includes('\0')) {
    throw new Error('Archive entry path is empty or contains null byte');
  }
  const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/g, '').trim();
  if (!normalized || normalized.startsWith('/')) {
    throw new Error(`Unsafe absolute path in archive: "${rawPath}"`);
  }
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Unsafe drive path in archive: "${rawPath}"`);
  }

  const rawSegments = normalized.split('/');
  const cleanSegments: string[] = [];
  for (let i = 0; i < rawSegments.length; i += 1) {
    const seg = rawSegments[i];
    if (seg === '' || (seg === '.' && i === 0)) continue;
    if (seg === '.' || seg === '..') {
      throw new Error(`Forbidden traversal segment in archive: "${rawPath}"`);
    }
    if (seg.includes(':')) {
      throw new Error(
        `Forbidden colon/drive/ADS segment in archive: "${rawPath}"`,
      );
    }
    if (/[. ]$/.test(seg)) {
      throw new Error(
        `Forbidden trailing dot or space in archive: "${rawPath}"`,
      );
    }
    const baseNoExt = seg
      .replace(/[. ]+$/, '')
      .split('.')[0]
      .toLowerCase();
    if (WINDOWS_RESERVED_BASENAMES.has(baseNoExt)) {
      throw new Error(`Forbidden reserved filename in archive: "${rawPath}"`);
    }
    cleanSegments.push(seg);
  }

  if (cleanSegments.length === 0) {
    throw new Error(`Invalid archive entry path: "${rawPath}"`);
  }
  return cleanSegments.join('/');
}

export function stripSingleRootWrapper(
  files: IExtractedArchiveFile[],
): IExtractedArchiveFile[] {
  if (files.length === 0) return files;
  const firstSegments = files.map((file) => file.relativePath.split('/')[0]);
  const sharedRoot = firstSegments[0];
  const allInsideSharedWrapper =
    files.every((file) => file.relativePath.startsWith(`${sharedRoot}/`)) &&
    files.every((file) => firstSegments[files.indexOf(file)] === sharedRoot);

  if (!allInsideSharedWrapper) {
    return files;
  }

  const stripped = files.map((file) => ({
    relativePath: file.relativePath.slice(sharedRoot.length + 1),
    content: file.content,
  }));

  const seen = new Set<string>();
  for (const entry of stripped) {
    if (!entry.relativePath || seen.has(entry.relativePath.toLowerCase())) {
      return files;
    }
    seen.add(entry.relativePath.toLowerCase());
  }
  return stripped;
}

function assertSizeAndRatio(
  uncompressedSize: number,
  compressedSize: number,
  cumulativeBytes: number,
): void {
  if (
    !Number.isSafeInteger(uncompressedSize) ||
    uncompressedSize < 0 ||
    uncompressedSize > MAX_PLUGIN_UNCOMPRESSED_BYTES ||
    cumulativeBytes + uncompressedSize > MAX_PLUGIN_UNCOMPRESSED_BYTES
  ) {
    throw new Error(
      `Archive uncompressed size exceeds limit of ${MAX_PLUGIN_UNCOMPRESSED_BYTES} bytes`,
    );
  }
  if (
    uncompressedSize > 64 * 1024 &&
    (compressedSize <= 0 ||
      uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
  ) {
    throw new Error('Archive rejected due to excessive compression ratio');
  }
}

export function extractZipBuffer(buffer: unknown): IExtractedArchiveFile[] {
  if (typeof buffer !== 'object' || !Buffer.isBuffer(buffer)) {
    throw new Error('Archive input must be a Buffer');
  }
  if (buffer.length > MAX_PLUGIN_ARCHIVE_BYTES) {
    throw new Error(
      `ZIP archive exceeds ${MAX_PLUGIN_ARCHIVE_BYTES} bytes limit`,
    );
  }

  let eocdOffset = -1;
  const minScan = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= minScan; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP archive: End of Central Directory not found');
  }

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const cdStartDisk = buffer.readUInt16LE(eocdOffset + 6);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    cdStartDisk !== 0 ||
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new Error('Multi-disk or Zip64 archives are not supported');
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new Error('Corrupt ZIP archive: Central Directory out of bounds');
  }
  if (totalEntries > MAX_PLUGIN_FILES * 2) {
    throw new Error(
      `ZIP archive exceeds file count limit (${MAX_PLUGIN_FILES})`,
    );
  }

  const files: IExtractedArchiveFile[] = [];
  const seenPaths = new Set<string>();
  let cursor = cdOffset;
  let cumulativeBytes = 0;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > cdOffset + cdSize) {
      throw new Error('Corrupt ZIP Central Directory header');
    }
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('Invalid ZIP Central Directory signature');
    }

    const versionMadeBy = buffer.readUInt16LE(cursor + 4);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const externalAttrs = buffer.readUInt32LE(cursor + 38);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

    if (cursor + 46 + nameLen + extraLen + commentLen > cdOffset + cdSize) {
      throw new Error('Corrupt ZIP Central Directory entry lengths');
    }

    const rawName = buffer
      .subarray(cursor + 46, cursor + 46 + nameLen)
      .toString('utf8');
    cursor += 46 + nameLen + extraLen + commentLen;

    const madeByHost = versionMadeBy >> 8;
    if (madeByHost === 3 || madeByHost === 19) {
      const unixMode = (externalAttrs >>> 16) & 0o170000;
      if (unixMode === 0o120000) {
        throw new Error(
          `ZIP archive contains forbidden symbolic link: ${rawName}`,
        );
      }
    }

    if ((flags & 0x1) !== 0) {
      throw new Error('Encrypted ZIP archives are not supported');
    }

    if (rawName.endsWith('/') || rawName.endsWith('\\')) {
      continue;
    }

    if (files.length >= MAX_PLUGIN_FILES) {
      throw new Error(
        `ZIP archive exceeds maximum of ${MAX_PLUGIN_FILES} files`,
      );
    }

    const cleanPath = sanitizeArchiveEntryPath(rawName);
    const dedupeKey = cleanPath.toLowerCase();
    if (seenPaths.has(dedupeKey)) {
      throw new Error(`ZIP archive contains duplicate path "${cleanPath}"`);
    }
    seenPaths.add(dedupeKey);

    assertSizeAndRatio(uncompressedSize, compressedSize, cumulativeBytes);

    if (localHeaderOffset + 30 > buffer.length) {
      throw new Error('Corrupt ZIP local file header offset');
    }
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error('Invalid ZIP local file header signature');
    }
    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > buffer.length) {
      throw new Error('ZIP entry data extends past archive EOF');
    }

    const compressedSlice = buffer.subarray(
      dataStart,
      dataStart + compressedSize,
    );
    let content: Buffer;
    if (method === 0) {
      content = Buffer.from(compressedSlice);
    } else if (method === 8) {
      content = inflateRawSync(compressedSlice, {
        maxOutputLength: uncompressedSize + 1,
      });
    } else {
      throw new Error(`Unsupported ZIP compression method (${method})`);
    }

    if (content.length !== uncompressedSize) {
      throw new Error(`ZIP entry size mismatch for "${cleanPath}"`);
    }
    cumulativeBytes += content.length;
    if (cumulativeBytes > MAX_PLUGIN_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Archive uncompressed size exceeds limit of ${MAX_PLUGIN_UNCOMPRESSED_BYTES} bytes`,
      );
    }

    files.push({ relativePath: cleanPath, content });
  }

  return stripSingleRootWrapper(files);
}

function readTarOctal(buf: Buffer): number {
  const str = buf.toString('utf8').replace(/\0.*$/g, '').trim();
  if (!str) return 0;
  if (!/^[0-7]+$/.test(str)) {
    throw new Error('Corrupt octal field in TAR header');
  }
  const parsed = Number.parseInt(str, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Corrupt octal field in TAR header');
  }
  return parsed;
}

function readTarString(buf: Buffer): string {
  return buf.toString('utf8').replace(/\0.*$/g, '');
}

export function extractTarGzBuffer(buffer: unknown): IExtractedArchiveFile[] {
  if (typeof buffer !== 'object' || !Buffer.isBuffer(buffer)) {
    throw new Error('Archive input must be a Buffer');
  }
  if (buffer.length > MAX_PLUGIN_ARCHIVE_BYTES) {
    throw new Error(
      `TGZ archive exceeds ${MAX_PLUGIN_ARCHIVE_BYTES} bytes limit`,
    );
  }

  const tarBuffer = gunzipSync(buffer, {
    maxOutputLength: MAX_PLUGIN_UNCOMPRESSED_BYTES + 1024 * 1024,
  });

  const files: IExtractedArchiveFile[] = [];
  const seenPaths = new Set<string>();
  let offset = 0;
  let cumulativeBytes = 0;
  let pendingLongName: string | null = null;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    offset += 512;

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const storedChecksum = readTarOctal(header.subarray(148, 156));
    let computed = 0;
    for (let i = 0; i < 512; i += 1) {
      computed += i >= 148 && i < 156 ? 32 : header[i];
    }
    if (storedChecksum !== computed) {
      throw new Error('Corrupt TAR header checksum');
    }

    const typeflag = String.fromCharCode(header[156]);
    const size = readTarOctal(header.subarray(124, 136));
    const blocks = Math.ceil(size / 512);
    const paddedBytes = blocks * 512;
    if (offset + paddedBytes > tarBuffer.length) {
      throw new Error('TAR entry extends past archive EOF');
    }
    const payload = tarBuffer.subarray(offset, offset + size);
    offset += paddedBytes;

    const baseName = readTarString(header.subarray(0, 100));
    const prefix = readTarString(header.subarray(345, 500));
    const headerName = prefix ? `${prefix}/${baseName}` : baseName;

    if (typeflag === 'L') {
      pendingLongName = readTarString(payload);
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g') {
      continue;
    }

    const effectiveName = pendingLongName ?? headerName;
    pendingLongName = null;

    if (typeflag === '1' || typeflag === '2') {
      throw new Error(`TAR archive contains forbidden link: ${effectiveName}`);
    }
    if (typeflag === '5') {
      continue;
    }
    if (typeflag !== '0' && typeflag !== '\0') {
      throw new Error(
        `TAR archive contains unsupported entry type "${typeflag}"`,
      );
    }

    if (files.length >= MAX_PLUGIN_FILES) {
      throw new Error(
        `TAR archive exceeds maximum of ${MAX_PLUGIN_FILES} files`,
      );
    }

    const cleanPath = sanitizeArchiveEntryPath(effectiveName);
    const dedupeKey = cleanPath.toLowerCase();
    if (seenPaths.has(dedupeKey)) {
      throw new Error(`TAR archive contains duplicate path "${cleanPath}"`);
    }
    seenPaths.add(dedupeKey);

    cumulativeBytes += size;
    if (cumulativeBytes > MAX_PLUGIN_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Archive uncompressed size exceeds limit of ${MAX_PLUGIN_UNCOMPRESSED_BYTES} bytes`,
      );
    }

    files.push({ relativePath: cleanPath, content: Buffer.from(payload) });
  }

  return stripSingleRootWrapper(files);
}
