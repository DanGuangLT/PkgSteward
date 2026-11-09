import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import {
  link,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { createDiskFs } from '@/disk-usage/traversal/disk-usage-walker';
import { deleteTarget } from '@/file-ops/deletion/file-deleter';
import { createFileOpsFs } from '@/file-ops/deletion/file-ops-fs';
import { measureTarget } from '@/file-ops/tree/file-ops-measure';
import { createRecycleBin } from '@/platform/recycle/recycle-bin.factory';

const baseDir = process.env.PKGSTEWARD_REAL_FS_TEST_DIR;
const destructive = process.env.PKGSTEWARD_DESTRUCTIVE_FS_TEST === '1';
const destructiveWindows =
  process.platform === 'win32' && !!baseDir && destructive
    ? describe
    : describe.skip;

// A Node file handle allows deletion, so only another process can produce a real EBUSY.
const LOCK_SCRIPT = `$file = [IO.File]::Open($env:PKGSTEWARD_LOCK_PATH, 'Open', 'ReadWrite', 'None'); Write-Output 'locked'; Start-Sleep -Seconds 60`;

async function holdExclusiveLock(path: string): Promise<() => Promise<void>> {
  const holder = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', LOCK_SCRIPT],
    {
      env: { ...process.env, PKGSTEWARD_LOCK_PATH: path },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    },
  );
  await once(holder.stdout, 'data');
  return async () => {
    const exited = once(holder, 'exit');
    holder.kill();
    await exited;
  };
}

// Destructive opt-in: every path lives in a fresh UUID folder under the chosen test directory.
destructiveWindows(
  'File deletion on real Windows filesystems (requires win32 + PKGSTEWARD_REAL_FS_TEST_DIR + PKGSTEWARD_DESTRUCTIVE_FS_TEST=1)',
  () => {
    jest.setTimeout(60_000);
    let root: string;
    const deps = () => ({
      rm: createFileOpsFs().remove,
      recycleBin: createRecycleBin('win32'),
    });

    beforeEach(async () => {
      root = join(baseDir ?? '', `pkgsteward-test-${randomUUID()}`);
      await mkdir(root);
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    });

    it('removes a junction inside a target and keeps what it points at', async () => {
      const target = join(root, 'node_modules');
      const outside = join(root, 'outside');
      const sentinel = join(outside, 'sentinel.txt');
      await mkdir(target);
      await mkdir(outside);
      await writeFile(sentinel, 'TEST-sentinel');
      await symlink(outside, join(target, 'linked'), 'junction');
      expect(existsSync(join(target, 'linked', 'sentinel.txt'))).toBe(true);

      await expect(
        deleteTarget(
          { path: target, kind: 'node_modules', apparentBytes: 0 },
          deps(),
        ),
      ).resolves.toEqual({ method: 'permanent', status: 'success' });

      expect(existsSync(target)).toBe(false);
      await expect(readFile(sentinel, 'utf8')).resolves.toBe('TEST-sentinel');
    });

    it('reports a hardlink to an outside file as shared and keeps that file readable', async () => {
      const target = join(root, 'node_modules');
      const outsideFile = join(root, 'store.bin');
      await mkdir(target);
      await writeFile(outsideFile, 'TEST-shared');
      await link(outsideFile, join(target, 'shared.bin'));
      await writeFile(join(target, 'own.bin'), 'TEST-own');

      await expect(
        measureTarget(target, {
          fs: createDiskFs(),
          platform: 'win32',
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        status: 'done',
        size: {
          reclaimableBytes: 'TEST-own'.length,
          sharedBytes: 'TEST-shared'.length,
        },
      });

      await expect(
        deleteTarget(
          { path: target, kind: 'node_modules', apparentBytes: 0 },
          deps(),
        ),
      ).resolves.toEqual({ method: 'permanent', status: 'success' });

      expect(existsSync(target)).toBe(false);
      await expect(readFile(outsideFile, 'utf8')).resolves.toBe('TEST-shared');
    });

    it('reports a locked file as FILE_IN_USE and that the target may be partial', async () => {
      const target = join(root, 'node_modules');
      const locked = join(target, 'locked.bin');
      await mkdir(target);
      await writeFile(locked, 'TEST-locked');
      const release = await holdExclusiveLock(locked);
      try {
        await expect(
          deleteTarget(
            { path: target, kind: 'node_modules', apparentBytes: 0 },
            deps(),
          ),
        ).resolves.toEqual({
          method: 'permanent',
          status: 'failed',
          errorCode: 'FILE_IN_USE',
          mayBePartial: true,
        });
        expect(existsSync(locked)).toBe(true);
      } finally {
        await release();
      }
    });

    it('moves a folder to the Recycle Bin as one unit', async () => {
      const target = join(root, `pkgsteward-test-${randomUUID()}`);
      await mkdir(target);
      await writeFile(join(target, 'recycled.txt'), 'TEST-recycled');

      await expect(
        deleteTarget(
          {
            path: target,
            kind: 'project_content',
            apparentBytes: 'TEST-recycled'.length,
          },
          deps(),
        ),
      ).resolves.toEqual({ method: 'recycle', status: 'success' });

      expect(existsSync(target)).toBe(false);
    });

    it('keeps a folder whole when the Recycle Bin cannot take a locked file', async () => {
      const target = join(root, `pkgsteward-test-${randomUUID()}`);
      const locked = join(target, 'locked.bin');
      const sibling = join(target, 'sibling.txt');
      await mkdir(target);
      await writeFile(locked, 'TEST-locked');
      await writeFile(sibling, 'TEST-sibling');
      const release = await holdExclusiveLock(locked);
      try {
        await expect(
          deleteTarget(
            { path: target, kind: 'project_content', apparentBytes: 23 },
            deps(),
          ),
        ).resolves.toMatchObject({
          method: 'recycle',
          status: 'failed',
          mayBePartial: false,
        });
        expect(existsSync(locked)).toBe(true);
        expect(existsSync(sibling)).toBe(true);
      } finally {
        await release();
      }
    });

    it('removes a target holding a path longer than 260 characters', async () => {
      const target = join(root, 'node_modules');
      const deep = join(
        target,
        ...Array.from({ length: 12 }, () => 'd'.repeat(30)),
      );
      await mkdir(deep, { recursive: true });
      await writeFile(join(deep, 'deep.txt'), 'TEST-deep');
      expect(join(deep, 'deep.txt').length).toBeGreaterThan(260);

      await expect(
        deleteTarget(
          { path: target, kind: 'node_modules', apparentBytes: 0 },
          deps(),
        ),
      ).resolves.toEqual({ method: 'permanent', status: 'success' });

      expect(existsSync(target)).toBe(false);
    });

    it('removes and recycles targets with Unicode names', async () => {
      const removed = join(root, 'thư-mục-tiếng-Việt-日本語');
      const recycled = join(root, `pkgsteward-test-${randomUUID()}-tiếng-Việt`);
      for (const path of [removed, recycled]) {
        await mkdir(path);
        await writeFile(join(path, 'tệp.txt'), 'TEST-unicode');
      }

      await expect(
        deleteTarget(
          { path: removed, kind: 'node_modules', apparentBytes: 0 },
          deps(),
        ),
      ).resolves.toEqual({ method: 'permanent', status: 'success' });
      await expect(
        deleteTarget(
          { path: recycled, kind: 'project_content', apparentBytes: 12 },
          deps(),
        ),
      ).resolves.toEqual({ method: 'recycle', status: 'success' });

      expect(existsSync(removed)).toBe(false);
      expect(existsSync(recycled)).toBe(false);
    });
  },
);
