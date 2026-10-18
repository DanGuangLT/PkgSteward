import { lstat, realpath } from 'fs/promises';
import { join } from 'path';
import { PathGuard } from '@/core/path-guard/path-guard';

// Chạy tay trên máy dev Windows (D10), CI bỏ qua. Đặt PKGSTEWARD_REAL_FS_TEST_DIR=<base> sau khi chuẩn bị:
//   <base>\allowed\project\          thư mục thật
//   <base>\outside\secret.txt        đích nằm NGOÀI allowlist
//   <base>\allowed\escape  ──mklink /J──▶  <base>\outside
const baseDir = process.env.PKGSTEWARD_REAL_FS_TEST_DIR;
const describeReal =
  process.platform === 'win32' && baseDir ? describe : describe.skip;

describeReal(
  'PathGuard on the real filesystem (junction made with mklink /J)',
  () => {
    const allowedRoot = () => join(baseDir as string, 'allowed');
    const makeGuard = () =>
      new PathGuard({
        platform: 'win32',
        scanRoots: { kind: 'paths', paths: [allowedRoot()] },
        driveDetector: { listFixedDrives: () => Promise.resolve([]) },
        denylist: [],
        fs: { realpath: (p) => realpath(p), lstat: (p) => lstat(p) },
      });

    it('allows a real folder inside the root', async () =>
      expect(
        await makeGuard().check(join(allowedRoot(), 'project')),
      ).toMatchObject({
        allowed: true,
        path: { isSymbolicLink: false },
      }));

    it('sees the junction as a link via lstat', async () =>
      expect(
        (await lstat(join(allowedRoot(), 'escape'))).isSymbolicLink(),
      ).toBe(true));

    it('rejects the junction and files reached through it', async () => {
      const guard = makeGuard();
      expect(await guard.check(join(allowedRoot(), 'escape'))).toMatchObject({
        allowed: false,
        code: 'OUTSIDE_ALLOWLIST',
      });
      expect(
        await guard.check(join(allowedRoot(), 'escape', 'secret.txt')),
      ).toMatchObject({
        allowed: false,
        code: 'OUTSIDE_ALLOWLIST',
      });
    });
  },
);
