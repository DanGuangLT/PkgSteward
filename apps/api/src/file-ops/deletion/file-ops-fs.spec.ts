import * as fs from 'node:fs/promises';
import { PERMANENT_RM_OPTIONS } from '@/file-ops/deletion/file-deleter';
import { createFileOpsFs } from '@/file-ops/deletion/file-ops-fs';

jest.mock('node:fs/promises', () => ({
  lstat: jest.fn().mockResolvedValue('TEST-stat'),
  readdir: jest.fn().mockResolvedValue(['TEST-entry']),
  readFile: jest.fn().mockResolvedValue('TEST-text'),
  realpath: jest.fn().mockResolvedValue('TEST-real'),
  rm: jest.fn().mockResolvedValue(undefined),
}));

describe('createFileOpsFs', () => {
  const bundle = createFileOpsFs();
  const path = 'D:\\TEST-app';
  afterEach(() => jest.clearAllMocks());

  it('removes with the exact options the deleter passes', async () => {
    await bundle.remove(path, PERMANENT_RM_OPTIONS);
    expect(fs.rm).toHaveBeenCalledTimes(1);
    expect(fs.rm).toHaveBeenCalledWith(path, {
      recursive: true,
      force: false,
      maxRetries: 0,
    });
  });

  it('reads classification stats as bigint so identities keep full precision', async () => {
    await expect(bundle.files.lstat(path)).resolves.toBe('TEST-stat');
    expect(fs.lstat).toHaveBeenCalledWith(path, { bigint: true });
  });

  it('lists directories with file types and reads UTF-8 text', async () => {
    await bundle.files.readdir(path);
    expect(fs.readdir).toHaveBeenLastCalledWith(path, { withFileTypes: true });
    await bundle.scan.readdir(path);
    expect(fs.readdir).toHaveBeenLastCalledWith(path, { withFileTypes: true });
    await bundle.files.readFile(path);
    expect(fs.readFile).toHaveBeenLastCalledWith(path, 'utf8');
  });

  it('passes the abort signal through scan reads and keeps scan stats plain', async () => {
    const { signal } = new AbortController();
    await bundle.scan.readFile(path, signal);
    expect(fs.readFile).toHaveBeenLastCalledWith(path, {
      encoding: 'utf8',
      signal,
    });
    await bundle.scan.lstat(path);
    expect(fs.lstat).toHaveBeenLastCalledWith(path);
    await bundle.scan.realpath(path);
    expect(fs.realpath).toHaveBeenLastCalledWith(path);
  });
});
