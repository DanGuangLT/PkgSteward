import { win32 as path } from 'node:path';
import {
  fsFixture,
  key,
  root,
  fileStat,
} from '@/npm-runner/__fixtures__/runner-test.fixture';
import type {
  IPmFs,
  IPmFileStat,
  IPmProjectDeps,
  IPmWriteHandle,
} from '@/package-managers/interfaces/pm.runtime';

// TEST fixture; không phải yêu cầu nghiệp vụ. All IO stays in memory.
export function pmIoFixture() {
  const base = fsFixture();
  const manifest = path.join(root, 'package.json');
  base.put(manifest, '{"name":"TEST-pin","packageManager":"npm@11.16.0"}');
  const events: string[] = [];
  let serial = 100;
  const lstat = jest.fn(async (file: string): Promise<IPmFileStat> => ({
    ...(await base.fs.lstat(file)),
    nlink: 1,
  }));
  const open = jest.fn(async (file: string) => {
    const handle = await base.fs.open(file);
    return {
      ...handle,
      stat: async (): Promise<IPmFileStat> => ({
        ...(await handle.stat()),
        nlink: 1,
      }),
    };
  });
  const openExclusive = jest.fn(
    (file: string, flags: 'wx'): Promise<IPmWriteHandle> => {
      events.push(`open:${flags}`);
      if (base.files.has(key(file)))
        return Promise.reject(
          Object.assign(new Error('TEST exists'), { code: 'EEXIST' }),
        );
      base.put(file, '');
      base.stats.set(key(file), fileStat(0, { ino: ++serial }));
      const handle: IPmWriteHandle = {
        stat: () => lstat(file),
        write: jest.fn((bytes: Uint8Array) => {
          events.push('write');
          base.files.set(key(file), Buffer.from(bytes));
          base.stats.set(key(file), {
            ...base.stats.get(key(file))!,
            size: bytes.byteLength,
          });
          return Promise.resolve();
        }),
        sync: jest.fn(() => {
          events.push('sync');
          return Promise.resolve();
        }),
        close: jest.fn(() => {
          events.push('close');
          return Promise.resolve();
        }),
      };
      return Promise.resolve(handle);
    },
  );
  const rename = jest.fn((from: string, to: string): Promise<void> => {
    events.push('rename');
    base.files.set(key(to), base.files.get(key(from))!);
    base.stats.set(key(to), base.stats.get(key(from))!);
    base.remove(from);
    return Promise.resolve();
  });
  const unlink = jest.fn((file: string): Promise<void> => {
    events.push(`unlink:${file}`);
    if (!base.files.has(key(file)))
      return Promise.reject(
        Object.assign(new Error('TEST missing'), { code: 'ENOENT' }),
      );
    base.remove(file);
    return Promise.resolve();
  });
  const fs: IPmFs = { ...base.fs, lstat, open, openExclusive, rename, unlink };
  const deps: IPmProjectDeps = {
    ...base.deps,
    fs,
    uuid: () => '00000000-0000-4000-8000-000000000099',
  };
  return {
    ...base,
    fs,
    deps,
    manifest,
    events,
    lstat,
    open,
    openExclusive,
    rename,
    unlink,
  };
}
