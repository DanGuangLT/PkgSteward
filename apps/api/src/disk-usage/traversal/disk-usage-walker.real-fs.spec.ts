import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createDiskFs,
  walkDiskUsage,
} from '@/disk-usage/traversal/disk-usage-walker';
import type {
  DiskView,
  IDiskUsageJob,
} from '@/disk-usage/interfaces/disk-usage.types';

const fixtureDir = process.env.PKGSTEWARD_REAL_FS_TEST_DIR;
const windowsFixture =
  process.platform === 'win32' && !!fixtureDir ? describe : describe.skip;

// Read-only opt-in: the coordinator owns this fixture, including junctions.
windowsFixture(
  'DiskUsage Windows hardlinks/junctions (requires win32 + PKGSTEWARD_REAL_FS_TEST_DIR)',
  () => {
    const allowed = join(fixtureDir ?? '', 'disk-usage', 'allowed');
    const modules = join(allowed, 'node_modules');
    const packageA = join(
      modules,
      '.pnpm',
      'pkg-a@1.0.0',
      'node_modules',
      'pkg-a',
    );
    const packageB = join(modules, '@scope', 'b');

    const initial = (path: string, view: DiskView): IDiskUsageJob => ({
      jobId: 'e4261d1d-590f-48a4-a765-d6dedcff17e4',
      status: 'running',
      path,
      view,
      metric: 'unique-apparent',
      phase: 'listing',
      partial: true,
      stopReason: null,
      sizeBytes: null,
      fileCount: null,
      children: [],
      progress: {
        visitedDirs: 0,
        visitedEntries: 0,
        skippedCount: 0,
        skippedLinks: 0,
      },
      startedAt: '2026-10-27T00:00:00.000Z',
      measuredAt: null,
      cacheHit: false,
      failureCode: null,
    });

    const sizes = async () => {
      const [manifestA, manifestB, bin] = await Promise.all([
        lstat(join(packageA, 'package.json'), { bigint: true }),
        lstat(join(packageB, 'package.json'), { bigint: true }),
        lstat(join(modules, '.bin', 'tool.cmd'), { bigint: true }),
      ]);
      return {
        a: 500 + Number(manifestA.size),
        b: 300 + Number(manifestB.size),
        bin: Number(bin.size),
      };
    };

    const measure = async (path: string, view: DiskView) => {
      const fs = createDiskFs();
      const entries = jest.fn((directory: string, signal: AbortSignal) =>
        fs.entries(directory, signal),
      );
      const result = await walkDiskUsage(
        initial(await realpath(path), view),
        new AbortController().signal,
        {
          fs: { ...fs, entries },
          platform: 'win32',
          isProtected: () => false,
          onSnapshot: () => undefined,
        },
      );
      // Neither the escaped alias nor its canonical outside target may be opened.
      const opened = entries.mock.calls.map(([directory]) =>
        directory.toLowerCase(),
      );
      expect(opened).not.toContain(join(modules, 'escape').toLowerCase());
      expect(opened).not.toContain(
        join(fixtureDir ?? '', 'disk-usage', 'outside').toLowerCase(),
      );
      return result;
    };

    it('uses bigint dev/ino to count the two 1000-byte hardlinks once and excludes the 100-byte outside file', async () => {
      const [a, link] = await Promise.all([
        lstat(join(allowed, 'a.txt'), { bigint: true }),
        lstat(join(allowed, 'a-link.txt'), { bigint: true }),
      ]);
      expect(a.dev).toBe(link.dev);
      expect(a.ino).toBe(link.ino);
      expect(a.nlink).toBeGreaterThan(1n);
      expect(a.size).toBe(1000n);
      const expected = await sizes();
      const result = await measure(allowed, 'directory');
      expect(result.status).toBe('completed');
      expect(result.sizeBytes).toBe(
        1000 + expected.a + expected.b + expected.bin,
      );
      expect(result.fileCount).toBe(6);
      expect(result.progress.skippedLinks).toBeGreaterThanOrEqual(2);
    });

    it('includes the internal package junction and scoped package but excludes the escaping junction', async () => {
      expect((await lstat(join(modules, 'pkg-a'))).isSymbolicLink()).toBe(true);
      expect((await lstat(join(modules, 'escape'))).isSymbolicLink()).toBe(
        true,
      );
      const expected = await sizes();
      const result = await measure(modules, 'packages');
      // The escaping link is excluded, but the physical root total stays exact.
      expect(result.partial).toBe(false);
      expect(result.sizeBytes).toBe(expected.a + expected.b + expected.bin);
      expect(result.fileCount).toBe(5);
      const a = result.children.find((row) => row.aliases.includes('pkg-a'));
      expect(a).toMatchObject({
        kind: 'package',
        state: 'complete',
        sizeBytes: expected.a,
        fileCount: 2,
        canonicalPath: await realpath(packageA),
      });
      expect(
        result.children.find((row) => row.name === '@scope/b'),
      ).toMatchObject({
        state: 'complete',
        sizeBytes: expected.b,
        fileCount: 2,
      });
      expect(
        result.children.find((row) => row.name === 'escape'),
      ).toMatchObject({
        state: 'excluded',
        reason: 'outside_root',
        canonicalPath: null,
        sizeBytes: null,
      });
    });
  },
);
