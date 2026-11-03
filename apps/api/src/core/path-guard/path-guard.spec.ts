import {
  ForbiddenException,
  InternalServerException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import type { ScanRoots } from '@/config/scan-roots';
import { buildDenylist } from '@/core/path-guard/denylist';
import { PathGuard } from '@/core/path-guard/path-guard';
import { ConfigService } from '@nestjs/config';
import { AppPathsService } from '@/core/app-paths/app-paths.service';
import type { IPathGuardDeps } from '@/core/path-guard/path-guard';
import type { PathCheckResult } from '@/core/path-guard/interfaces/path-guard.types';
import { PathGuardService } from '@/core/path-guard/path-guard.service';

const denylist = buildDenylist({
  platform: 'win32',
  env: {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramData: 'C:\\ProgramData',
  },
  homeDir: 'C:\\Users\\alice',
  appInstallDir: 'D:\\Tools\\PkgSteward\\apps\\api',
  sourceCheckoutDir: 'D:\\Tools\\PkgSteward',
  dataDir: 'C:\\Users\\alice\\AppData\\Local\\PkgSteward',
});

const errno = (code: string) => Object.assign(new Error(code), { code });

// links: path → realpath; missing: realpath ném ENOENT.
const makeFs = (
  links: Record<string, string> = {},
  missing: string[] = [],
) => ({
  realpath: jest.fn((p: string) =>
    missing.includes(p)
      ? Promise.reject(errno('ENOENT'))
      : Promise.resolve(links[p] ?? p),
  ),
  lstat: jest.fn((p: string) =>
    Promise.resolve({ isSymbolicLink: () => p in links }),
  ),
});

const makeGuard = ({
  scanRoots = { kind: 'paths', paths: ['D:\\Scan'] },
  drives = ['C:\\', 'D:\\', 'E:\\'],
  fs = makeFs(),
} = {}) => {
  const driveDetector = {
    listFixedDrives: jest.fn(() => Promise.resolve(drives)),
  };
  return {
    guard: new PathGuard({
      platform: 'win32',
      scanRoots,
      driveDetector,
      denylist,
      fs,
    }),
    driveDetector,
  };
};
const ALL = { kind: 'all-fixed-drives' } as ScanRoots;

describe('PathGuard.checkMany', () => {
  // A separately typed fixture keeps the pre-existing makeGuard TS2322 issue out of new cases.
  const batchFixture = (
    options: Partial<
      Pick<IPathGuardDeps, 'scanRoots' | 'platform' | 'denylist'>
    > & {
      fs?: ReturnType<typeof makeFs>;
    } = {},
  ) => {
    const fs = options.fs ?? makeFs();
    const driveDetector = {
      listFixedDrives: jest.fn(() => Promise.resolve(['C:\\', 'D:\\', 'E:\\'])),
    };
    const guard = new PathGuard({
      platform: options.platform ?? 'win32',
      scanRoots: options.scanRoots ?? ALL,
      denylist: options.denylist ?? denylist,
      driveDetector,
      fs,
    });
    return { guard, driveDetector, fs };
  };
  const inputs = ['D:\\Scan\\one', 'D:\\Scan\\two', 'D:\\Scan\\three'] as const;
  const noIO = (f: ReturnType<typeof batchFixture>) => {
    expect(f.driveDetector.listFixedDrives).not.toHaveBeenCalled();
    expect(f.fs.realpath).not.toHaveBeenCalled();
    expect(f.fs.lstat).not.toHaveBeenCalled();
  };

  afterEach(() => jest.restoreAllMocks());

  describe('createOperationChecker', () => {
    it('reuses fixed-drive discovery across sequential calls of one checker', async () => {
      const f = batchFixture();
      const checkPaths = f.guard.createOperationChecker();

      for (const input of inputs) {
        expect(await checkPaths([input])).toMatchObject([{ allowed: true }]);
      }

      expect(f.driveDetector.listFixedDrives).toHaveBeenCalledTimes(1);
      expect(f.fs.lstat.mock.calls.map(([path]) => path)).toEqual(inputs);
    });

    it('retries drive discovery after a rejected call of the same checker', async () => {
      const f = batchFixture();
      const error = new InternalServerException('TEST discovery failed');
      f.driveDetector.listFixedDrives.mockRejectedValueOnce(error);
      const checkPaths = f.guard.createOperationChecker();

      await expect(checkPaths(inputs)).rejects.toBe(error);
      expect(f.fs.realpath).not.toHaveBeenCalled();
      expect(f.fs.lstat).not.toHaveBeenCalled();
      expect(await checkPaths(inputs)).toMatchObject([
        { allowed: true },
        { allowed: true },
        { allowed: true },
      ]);
      expect(f.driveDetector.listFixedDrives).toHaveBeenCalledTimes(2);
    });

    it('discovers drives independently for two operation checkers', async () => {
      const f = batchFixture();
      const first = f.guard.createOperationChecker();
      const second = f.guard.createOperationChecker();

      expect(await first([inputs[0]])).toMatchObject([{ allowed: true }]);
      f.driveDetector.listFixedDrives.mockResolvedValue(['E:\\']);
      expect(await second([inputs[0]])).toMatchObject([
        { allowed: false, code: 'OUTSIDE_ALLOWLIST' },
      ]);
      expect(await first([inputs[0]])).toMatchObject([{ allowed: true }]);
      expect(f.driveDetector.listFixedDrives).toHaveBeenCalledTimes(2);
    });

    it('resolves scan roots again on each call of the same checker', async () => {
      const input = 'D:\\Scan\\app';
      const links = {
        'D:\\': 'F:\\Old',
        [input]: 'F:\\Old\\Scan\\app',
      };
      const f = batchFixture({ fs: makeFs(links) });
      const checkPaths = f.guard.createOperationChecker();

      expect(await checkPaths([input])).toMatchObject([{ allowed: true }]);
      links['D:\\'] = 'F:\\New';
      expect(await checkPaths([input])).toMatchObject([
        { allowed: false, code: 'OUTSIDE_ALLOWLIST' },
      ]);
      expect(
        f.fs.realpath.mock.calls.filter(([path]) => path === 'D:\\'),
      ).toHaveLength(2);
      expect(f.driveDetector.listFixedDrives).toHaveBeenCalledTimes(1);
    });

    it('resolves protected junctions again on each call of the same checker', async () => {
      const protectedPath = 'd:\\tools\\pkgsteward\\apps\\api';
      const links = { [protectedPath]: 'E:\\Protected\\Old' };
      const f = batchFixture({ fs: makeFs(links) });
      const checkPaths = f.guard.createOperationChecker();
      const paths = ['E:\\Protected\\Old\\child', 'E:\\Protected\\New\\child'];

      expect(await checkPaths(paths)).toMatchObject([
        { allowed: false, code: 'DENYLISTED' },
        { allowed: true },
      ]);
      links[protectedPath] = 'E:\\Protected\\New';
      expect(await checkPaths(paths)).toMatchObject([
        { allowed: true },
        { allowed: false, code: 'DENYLISTED' },
      ]);
      for (const entry of denylist) {
        expect(
          f.fs.realpath.mock.calls.filter(([path]) => path === entry.path),
        ).toHaveLength(2);
      }
      expect(f.driveDetector.listFixedDrives).toHaveBeenCalledTimes(1);
    });

    it('refreshes target realpath and lstat on each call of the same checker', async () => {
      const input = 'D:\\Scan\\alias';
      const links = { [input]: 'D:\\Scan\\first' };
      const f = batchFixture({ fs: makeFs(links) });
      const checkPaths = f.guard.createOperationChecker();

      expect(await checkPaths([input])).toMatchObject([
        { allowed: true, path: { realPath: 'D:\\Scan\\first' } },
      ]);
      links[input] = 'D:\\Scan\\second';
      expect(await checkPaths([input])).toMatchObject([
        { allowed: true, path: { realPath: 'D:\\Scan\\second' } },
      ]);
      f.fs.lstat.mockRejectedValueOnce(errno('ENOENT'));
      expect(await checkPaths([input])).toMatchObject([
        { allowed: false, code: 'NOT_FOUND' },
      ]);
      expect(
        f.fs.realpath.mock.calls.filter(([path]) => path === input),
      ).toHaveLength(3);
      expect(f.fs.lstat).toHaveBeenCalledTimes(3);
      expect(f.driveDetector.listFixedDrives).toHaveBeenCalledTimes(1);
    });

    it('never detects drives for explicit roots across checker calls', async () => {
      const f = batchFixture({
        scanRoots: { kind: 'paths', paths: ['D:\\Scan'] },
      });
      const checkPaths = f.guard.createOperationChecker();

      for (const input of inputs) {
        expect(await checkPaths([input])).toMatchObject([{ allowed: true }]);
      }

      expect(f.driveDetector.listFixedDrives).not.toHaveBeenCalled();
    });
  });

  it('shares one fixed-drive discovery and one resolution of each deny entry per batch', async () => {
    const f = batchFixture();
    const results = await f.guard.checkMany(inputs);
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.allowed)).toBe(true);
    expect(f.driveDetector.listFixedDrives).toHaveBeenCalledTimes(1);
    for (const entry of denylist) {
      expect(
        f.fs.realpath.mock.calls.filter(([p]) => p === entry.path),
      ).toHaveLength(1);
    }
    // Roots and deny entries use distinct raw casing in this fixture.
    for (const root of ['C:\\', 'D:\\', 'E:\\']) {
      expect(f.fs.realpath.mock.calls.filter(([p]) => p === root)).toHaveLength(
        1,
      );
    }
    expect(f.fs.lstat.mock.calls.map(([p]) => p)).toEqual(inputs);
  });

  it('resolves each explicit scan root only once for multiple valid targets', async () => {
    const f = batchFixture({
      scanRoots: { kind: 'paths', paths: ['D:\\Scan', 'E:\\Scan'] },
    });
    await f.guard.checkMany(inputs);
    expect(f.driveDetector.listFixedDrives).not.toHaveBeenCalled();
    for (const root of ['D:\\Scan', 'E:\\Scan']) {
      expect(f.fs.realpath.mock.calls.filter(([p]) => p === root)).toHaveLength(
        1,
      );
    }
  });

  it('refreshes drives and protected junction targets on every call', async () => {
    const protectedPath = 'd:\\tools\\pkgsteward\\apps\\api';
    const links = { [protectedPath]: 'E:\\Protected\\Old' };
    const f = batchFixture({ fs: makeFs(links) });
    const paths = [
      'E:\\Protected\\Old\\child',
      'E:\\Protected\\New\\child',
      'D:\\Scan\\app',
    ];
    expect(await f.guard.checkMany(paths)).toMatchObject([
      { allowed: false, code: 'DENYLISTED' },
      { allowed: true },
      { allowed: true },
    ]);
    links[protectedPath] = 'E:\\Protected\\New';
    f.driveDetector.listFixedDrives.mockResolvedValue(['E:\\']);
    expect(await f.guard.checkMany(paths)).toMatchObject([
      { allowed: true },
      { allowed: false, code: 'DENYLISTED' },
      { allowed: false, code: 'OUTSIDE_ALLOWLIST' },
    ]);
    expect(f.driveDetector.listFixedDrives).toHaveBeenCalledTimes(2);
    for (const entry of denylist) {
      expect(
        f.fs.realpath.mock.calls.filter(([p]) => p === entry.path),
      ).toHaveLength(2);
    }
  });

  it('returns an empty result without filesystem or drive discovery calls', async () => {
    const f = batchFixture();
    expect(await f.guard.checkMany([])).toEqual([]);
    noIO(f);
  });

  it('rejects invalid inputs in place without any IO', async () => {
    const f = batchFixture();
    const paths = [
      '',
      '  ',
      'relative',
      'D:app',
      '\\Windows',
      'D:\\Scan\\..\\app',
      'D:\\Scan\\a\0b',
    ];
    const expected = await Promise.all(
      paths.map((path) => f.guard.check(path)),
    );
    expect(await f.guard.checkMany(paths)).toEqual(expected);
    expect(expected).toHaveLength(paths.length);
    expect(
      expected.every(
        (result) => !result.allowed && result.code === 'INVALID_PATH',
      ),
    ).toBe(true);
    noIO(f);
  });

  it('preserves order, duplicates, messages and guarded-path metadata exactly like individual checks', async () => {
    const f = batchFixture({
      scanRoots: { kind: 'paths', paths: ['D:\\Scan'] },
      fs: makeFs(
        {
          'D:\\Scan\\alias': 'D:\\Scan\\real',
          'D:\\Scan\\protected-link': 'C:\\Windows\\Temp',
          'D:\\Scan\\escape': 'E:\\Other',
        },
        ['D:\\Scan\\missing'],
      ),
    });
    const paths = Object.freeze([
      'D:/Scan/app/',
      'relative',
      'D:\\Scan\\..\\other',
      'C:\\Windows',
      'E:\\Other',
      'D:\\Scan\\missing',
      'D:\\Scan\\protected-link',
      'D:\\Scan\\alias',
      'D:/Scan/app/',
      'D:\\Scan\\escape',
    ]);
    const expected = await Promise.all(
      paths.map((path) => f.guard.check(path)),
    );
    expect(expected).toMatchObject([
      {
        allowed: true,
        path: {
          inputPath: paths[0],
          resolvedPath: 'D:\\Scan\\app',
          isSymbolicLink: false,
        },
      },
      { allowed: false, code: 'INVALID_PATH' },
      { allowed: false, code: 'INVALID_PATH' },
      { allowed: false, code: 'DENYLISTED' },
      { allowed: false, code: 'OUTSIDE_ALLOWLIST' },
      { allowed: false, code: 'NOT_FOUND' },
      { allowed: false, code: 'DENYLISTED' },
      {
        allowed: true,
        path: { realPath: 'D:\\Scan\\real', isSymbolicLink: true },
      },
      { allowed: true },
      { allowed: false, code: 'OUTSIDE_ALLOWLIST' },
    ]);
    expect(await f.guard.checkMany(paths)).toEqual(expected);
  });

  it('keeps posix paths case-sensitive while sharing the batch snapshot', async () => {
    const f = batchFixture({
      platform: 'posix',
      scanRoots: { kind: 'paths', paths: ['/TEST/scan'] },
      denylist: [
        {
          path: '/TEST/scan/protected',
          scope: 'subtree',
          reason: 'TEST protected',
        },
      ],
    });
    const paths = [
      '/TEST/scan/app',
      '/test/scan/app',
      '/TEST/scan/protected/child',
    ];
    const expected = await Promise.all(
      paths.map((path) => f.guard.check(path)),
    );
    expect(expected).toMatchObject([
      { allowed: true },
      { allowed: false, code: 'OUTSIDE_ALLOWLIST' },
      { allowed: false, code: 'DENYLISTED' },
    ]);
    expect(await f.guard.checkMany(paths)).toEqual(expected);
  });

  it.each([
    'denylist',
    'scan root',
    'target realpath',
    'target lstat',
  ] as const)(
    'rejects the entire batch when %s resolution fails with EACCES',
    async (source) => {
      const f = batchFixture({
        scanRoots: { kind: 'paths', paths: ['D:\\Scan'] },
      });
      const failing =
        source === 'denylist'
          ? denylist[0].path
          : source === 'scan root'
            ? 'D:\\Scan'
            : inputs[1];
      if (source === 'target lstat') {
        f.fs.lstat.mockImplementation((p) =>
          p === failing
            ? Promise.reject(errno('EACCES'))
            : Promise.resolve({ isSymbolicLink: () => false }),
        );
      } else {
        f.fs.realpath.mockImplementation((p) =>
          p === failing ? Promise.reject(errno('EACCES')) : Promise.resolve(p),
        );
      }
      await expect(f.guard.check(failing)).rejects.toBeInstanceOf(
        InternalServerException,
      );
      await expect(f.guard.checkMany(inputs)).rejects.toBeInstanceOf(
        InternalServerException,
      );
    },
  );

  it.each(['ENOENT', 'ENOTDIR'])(
    'keeps per-target %s failures as NOT_FOUND and returns the other results',
    async (code) => {
      const f = batchFixture();
      f.fs.lstat.mockImplementation((p) =>
        p === inputs[1]
          ? Promise.reject(errno(code))
          : Promise.resolve({ isSymbolicLink: () => false }),
      );
      expect(await f.guard.checkMany(inputs)).toMatchObject([
        { allowed: true },
        { allowed: false, code: 'NOT_FOUND' },
        { allowed: true },
      ]);
    },
  );

  it('fails closed when drive discovery fails', async () => {
    const f = batchFixture();
    f.driveDetector.listFixedDrives.mockRejectedValue(
      new InternalServerException('TEST discovery failed'),
    );
    await expect(f.guard.checkMany(inputs)).rejects.toBeInstanceOf(
      InternalServerException,
    );
    expect(f.fs.lstat).not.toHaveBeenCalled();
  });

  it('delegates PathGuardService.checkMany to its guard with the original ordered inputs', async () => {
    const results: PathCheckResult[] = [
      { allowed: false, code: 'INVALID_PATH', message: 'TEST invalid' },
    ];
    const checkMany = jest
      .spyOn(PathGuard.prototype, 'checkMany')
      .mockResolvedValue(results);
    const service = new PathGuardService(
      new ConfigService({ SCAN_ROOT_PATHS: '*' }),
      {
        appInstallDir: 'D:\\TEST\\install',
        sourceCheckoutDir: null,
        dataDir: 'D:\\TEST\\data',
      } as AppPathsService,
      { listFixedDrives: jest.fn() },
    );
    const paths = Object.freeze(['relative']);
    expect(await service.checkMany(paths)).toBe(results);
    expect(checkMany).toHaveBeenCalledTimes(1);
    expect(checkMany).toHaveBeenCalledWith(paths);
  });
});

describe('PathGuard protected-tree matcher', () => {
  const protectedPath = 'd:\\tools\\pkgsteward\\apps\\api';

  it.each([
    ['C:\\', false],
    ['C:\\Users', false],
    ['C:\\Users\\alice', false],
    ['C:\\Users\\alice\\Projects', false],
    ['D:\\Tools', false],
    ['C:\\Windows', true],
    ['C:\\Windows\\x', true],
    ['E:\\Program Files\\y', true],
    ['D:\\Tools\\PkgSteward\\apps\\api', true],
    ['D:\\Tools\\PkgSteward\\apps\\api\\src', true],
    ['C:\\Users\\alice\\AppData\\Local\\PkgSteward', true],
    ['C:\\Users\\alice\\AppData\\Local\\PkgSteward\\logs', true],
    ['E:\\Protected\\ActualApp', true],
    ['e:/PROTECTED/ActualApp/child/', true],
    ['E:\\Protected', false],
    ['E:\\Protected\\ActualAppOther', false],
  ])('matches win32 pruning for %s', async (target, expected) => {
    const fs = makeFs({ [protectedPath]: 'E:\\Protected\\ActualApp' });
    const { guard } = makeGuard({ fs });
    const matcher = await guard.createProtectedTreeMatcher();

    expect(matcher(target)).toBe(expected);
    expect(matcher(target)).toBe(await guard.isInsideProtectedTree(target));
  });

  it.each([
    ['/', false],
    ['/home', false],
    ['/home/alice', false],
    ['/home/alice/code', false],
    ['/opt/pkgsteward/apps/api', true],
    ['/opt/pkgsteward/apps/api/src', true],
    ['/opt/PkgSteward/apps/api', false],
    ['/home/alice/.local/share/PkgSteward/cache', true],
    ['/srv/protected/app', true],
    ['/srv/protected/app/child', true],
    ['/srv/protected', false],
  ])('matches posix pruning for %s', async (target, expected) => {
    const guard = new PathGuard({
      platform: 'posix',
      scanRoots: { kind: 'paths', paths: ['/home/alice/code'] },
      driveDetector: { listFixedDrives: jest.fn() },
      denylist: buildDenylist({
        platform: 'posix',
        env: {},
        homeDir: '/home/alice',
        appInstallDir: '/opt/pkgsteward/apps/api',
        sourceCheckoutDir: null,
        dataDir: '/home/alice/.local/share/PkgSteward',
      }),
      fs: makeFs({ '/opt/pkgsteward/apps/api': '/srv/protected/app' }),
    });
    const matcher = await guard.createProtectedTreeMatcher();

    expect(matcher(target)).toBe(expected);
    expect(matcher(target)).toBe(await guard.isInsideProtectedTree(target));
  });

  it('resolves each deny entry once and performs no I/O in the predicate', async () => {
    const fs = makeFs();
    const { guard, driveDetector } = makeGuard({ fs });
    const matcher = await guard.createProtectedTreeMatcher();
    expect(fs.realpath).toHaveBeenCalledTimes(denylist.length);
    expect(fs.realpath.mock.calls.map(([p]) => p)).toEqual(
      denylist.map((entry) => entry.path),
    );

    for (let i = 0; i < 100; i++) {
      expect(matcher(`C:\\Windows\\child-${i}`)).toBe(true);
    }
    expect(fs.realpath).toHaveBeenCalledTimes(denylist.length);
    expect(fs.lstat).not.toHaveBeenCalled();
    expect(driveDetector.listFixedDrives).not.toHaveBeenCalled();
  });

  it.each(['ENOENT', 'ENOTDIR'])(
    'keeps lexical protection and other entries when realpath returns %s',
    async (code) => {
      // dataDir: không có mục subtree cha nào trong denylist che hộ, nên bảo vệ lexical phải tự đứng.
      const dataPath = 'c:\\users\\alice\\appdata\\local\\pkgsteward';
      const fs = makeFs();
      fs.realpath.mockImplementation((p: string) =>
        p === dataPath ? Promise.reject(errno(code)) : Promise.resolve(p),
      );
      const matcher = await makeGuard({
        fs,
      }).guard.createProtectedTreeMatcher();

      expect(matcher('C:\\Users\\alice\\AppData\\Local\\PkgSteward')).toBe(
        true,
      );
      expect(
        matcher('C:\\Users\\alice\\AppData\\Local\\PkgSteward\\logs'),
      ).toBe(true);
      expect(matcher('D:\\Tools\\PkgSteward\\apps\\api\\src')).toBe(true);
      expect(matcher('D:\\Scan\\app')).toBe(false);
      expect(fs.realpath).toHaveBeenCalledTimes(denylist.length);
    },
  );

  it.each(['EACCES', 'EIO'])(
    'fails closed when creating a matcher encounters %s',
    async (code) => {
      const fs = makeFs();
      fs.realpath.mockImplementation((p: string) =>
        p === protectedPath ? Promise.reject(errno(code)) : Promise.resolve(p),
      );
      await expect(
        makeGuard({ fs }).guard.createProtectedTreeMatcher(),
      ).rejects.toBeInstanceOf(InternalServerException);
    },
  );

  it('still resolves every deny entry on each async pruning call', async () => {
    const fs = makeFs();
    const { guard } = makeGuard({ fs });
    expect(await guard.isInsideProtectedTree('C:\\Windows')).toBe(true);
    expect(fs.realpath).toHaveBeenCalledTimes(denylist.length);
    expect(await guard.isInsideProtectedTree('D:\\Scan')).toBe(false);
    expect(fs.realpath).toHaveBeenCalledTimes(2 * denylist.length);
  });

  it('rechecks junction targets for authorization independently of an existing matcher', async () => {
    const links = { [protectedPath]: 'E:\\Protected\\Old' };
    const { guard } = makeGuard({ scanRoots: ALL, fs: makeFs(links) });
    const matcher = await guard.createProtectedTreeMatcher();
    await expect(
      guard.check('E:\\Protected\\Old\\child'),
    ).resolves.toMatchObject({
      allowed: false,
      code: 'DENYLISTED',
    });

    links[protectedPath] = 'E:\\Protected\\New';
    await expect(
      guard.check('E:\\Protected\\Old\\child'),
    ).resolves.toMatchObject({
      allowed: true,
    });
    await expect(
      guard.check('E:\\Protected\\New\\child'),
    ).resolves.toMatchObject({
      allowed: false,
      code: 'DENYLISTED',
    });
    expect(matcher('E:\\Protected\\Old\\child')).toBe(true);
    expect(matcher('E:\\Protected\\New\\child')).toBe(false);
  });
});

describe('PathGuard (win32)', () => {
  it('allows a folder inside a scan root', async () => {
    const { guard } = makeGuard();
    await expect(guard.check('D:\\Scan\\app')).resolves.toEqual({
      allowed: true,
      path: {
        inputPath: 'D:\\Scan\\app',
        resolvedPath: 'D:\\Scan\\app',
        realPath: 'D:\\Scan\\app',
        isSymbolicLink: false,
      },
    });
  });

  it.each([
    'D:\\Scan\\app\\..\\..\\Windows',
    'D:/Scan/../Other',
    'D:\\Scan\\..',
  ])('rejects traversal %s', async (p) =>
    expect(await makeGuard().guard.check(p)).toMatchObject({
      allowed: false,
      code: 'INVALID_PATH',
    }),
  );

  it('compares paths case-insensitively and accepts forward slashes', async () => {
    const { guard } = makeGuard();
    expect(await guard.check('d:\\SCAN\\App')).toMatchObject({ allowed: true });
    expect(await guard.check('D:/Scan/App/')).toMatchObject({
      allowed: true,
      path: { resolvedPath: 'D:\\Scan\\App' },
    });
    expect(
      await makeGuard({ scanRoots: ALL }).guard.check('c:\\WINDOWS\\system32'),
    ).toMatchObject({
      allowed: false,
      code: 'DENYLISTED',
    });
  });

  it.each(['C:\\', 'C:\\Users', 'D:\\Tools'])(
    'blocks %s (contains a protected folder)',
    async (p) =>
      expect(await makeGuard({ scanRoots: ALL }).guard.check(p)).toMatchObject({
        allowed: false,
        code: 'DENYLISTED',
      }),
  );

  it('blocks the profile folder itself but allows its children', async () => {
    const { guard } = makeGuard({ scanRoots: ALL });
    expect(await guard.check('C:\\Users\\alice')).toMatchObject({
      code: 'DENYLISTED',
    });
    expect(await guard.check('C:\\Users\\alice\\AppData')).toMatchObject({
      code: 'DENYLISTED',
    });
    expect(await guard.check('C:\\Users\\alice\\Projects\\app')).toMatchObject({
      allowed: true,
    });
    expect(
      await guard.check('C:\\Users\\alice\\AppData\\Roaming\\npm'),
    ).toMatchObject({ allowed: true });
  });

  it.each([
    'C:\\Program Files (x86)\\Foo',
    'E:\\Program Files (x86)\\Foo',
    'D:\\$Recycle.Bin\\S-1-5',
  ])('blocks %s', async (p) =>
    expect(await makeGuard({ scanRoots: ALL }).guard.check(p)).toMatchObject({
      code: 'DENYLISTED',
    }),
  );

  it.each([
    'D:\\Tools\\PkgSteward\\apps\\api\\src',
    'D:\\Tools\\PkgSteward\\apps\\web',
    'C:\\Users\\alice\\AppData\\Local\\PkgSteward\\logs',
  ])('blocks appInstallDir / source repo / dataDir content %s', async (p) =>
    expect(await makeGuard({ scanRoots: ALL }).guard.check(p)).toMatchObject({
      code: 'DENYLISTED',
    }),
  );

  it('blocks a junction whose target is a system folder', async () => {
    const fs = makeFs({ 'D:\\Scan\\link': 'C:\\Windows\\Temp' });
    const result = await makeGuard({ fs }).guard.check('D:\\Scan\\link');
    expect(result).toMatchObject({ allowed: false, code: 'DENYLISTED' });
    expect(result.allowed === false && result.message).toMatch(
      /after resolving links/,
    );
  });

  it('blocks a junction that escapes the scan roots', async () => {
    const fs = makeFs({ 'D:\\Scan\\escape': 'E:\\Other' });
    expect(
      await makeGuard({ fs }).guard.check('D:\\Scan\\escape'),
    ).toMatchObject({
      allowed: false,
      code: 'OUTSIDE_ALLOWLIST',
    });
  });

  it('allows a junction that stays inside and reports it via lstat', async () => {
    const fs = makeFs({ 'D:\\Scan\\alias': 'D:\\Scan\\real' });
    expect(await makeGuard({ fs }).guard.check('D:\\Scan\\alias')).toEqual({
      allowed: true,
      path: {
        inputPath: 'D:\\Scan\\alias',
        resolvedPath: 'D:\\Scan\\alias',
        realPath: 'D:\\Scan\\real',
        isSymbolicLink: true,
      },
    });
  });

  it('catches 8.3 names and trailing dots through realpath', async () => {
    const fs = makeFs({
      'D:\\Scan\\x': 'D:\\Scan\\x',
      'C:\\PROGRA~1\\x': 'C:\\Program Files\\x',
      'C:\\Windows.': 'C:\\Windows',
    });
    const { guard } = makeGuard({ scanRoots: ALL, fs });
    expect(await guard.check('C:\\PROGRA~1\\x')).toMatchObject({
      code: 'DENYLISTED',
    });
    expect(await guard.check('C:\\Windows.')).toMatchObject({
      code: 'DENYLISTED',
    });
  });

  it('accepts children of a scan root that is itself a junction', async () => {
    const fs = makeFs({
      'D:\\Scan': 'E:\\RealScan',
      'D:\\Scan\\app': 'E:\\RealScan\\app',
    });
    expect(await makeGuard({ fs }).guard.check('D:\\Scan\\app')).toMatchObject({
      allowed: true,
    });
  });

  it.each(['EACCES', 'EIO'])(
    'fails closed when the scan root realpath returns %s',
    async (code) => {
      const fs = makeFs();
      fs.realpath.mockImplementation((p: string) =>
        p === 'D:\\Scan' ? Promise.reject(errno(code)) : Promise.resolve(p),
      );
      const { guard } = makeGuard({ fs });
      await expect(guard.check('D:\\Scan\\app')).rejects.toBeInstanceOf(
        InternalServerException,
      );
      expect(fs.lstat).not.toHaveBeenCalled();
    },
  );

  it.each(['ENOENT', 'ENOTDIR'])(
    'keeps other scan roots usable when a root realpath returns %s',
    async (code) => {
      const fs = makeFs();
      fs.realpath.mockImplementation((p: string) =>
        p === 'E:\\Missing' ? Promise.reject(errno(code)) : Promise.resolve(p),
      );
      const { guard } = makeGuard({
        scanRoots: { kind: 'paths', paths: ['E:\\Missing', 'D:\\Scan'] },
        fs,
      });
      await expect(guard.check('D:\\Scan\\app')).resolves.toMatchObject({
        allowed: true,
      });
    },
  );

  it.each([
    'projects\\app',
    'C:foo',
    '\\Windows',
    '\\\\server\\share\\x',
    '',
    'D:\\Scan\\a\0b',
  ])('rejects non-absolute or malformed input %p', async (p) =>
    expect(await makeGuard().guard.check(p)).toMatchObject({
      allowed: false,
      code: 'INVALID_PATH',
    }),
  );

  it('treats "*" with no fixed drive as an empty allowlist', async () =>
    expect(
      await makeGuard({ scanRoots: ALL, drives: [] }).guard.check(
        'D:\\Scan\\app',
      ),
    ).toMatchObject({
      allowed: false,
      code: 'OUTSIDE_ALLOWLIST',
    }));

  it('fails closed when fixed drives cannot be listed', async () => {
    const { guard, driveDetector } = makeGuard({ scanRoots: ALL });
    driveDetector.listFixedDrives.mockRejectedValue(
      new InternalServerException('only supported on Windows'),
    );
    await expect(guard.check('D:\\Scan\\app')).rejects.toThrow(
      /only supported on Windows/,
    );
  });

  it('lists fixed drives once per check', async () => {
    const { guard, driveDetector } = makeGuard({ scanRoots: ALL });
    await guard.check('D:\\Scan\\app');
    expect(driveDetector.listFixedDrives).toHaveBeenCalledTimes(1);
  });

  it('reports missing paths as NOT_FOUND', async () => {
    const fs = makeFs({}, ['D:\\Scan\\gone']);
    expect(await makeGuard({ fs }).guard.check('D:\\Scan\\gone')).toMatchObject(
      {
        allowed: false,
        code: 'NOT_FOUND',
      },
    );
  });

  it('fails closed on other realpath errors', async () => {
    const fs = makeFs();
    fs.realpath.mockImplementation((p: string) =>
      p === 'D:\\Scan\\locked'
        ? Promise.reject(errno('EACCES'))
        : Promise.resolve(p),
    );
    await expect(
      makeGuard({ fs }).guard.check('D:\\Scan\\locked'),
    ).rejects.toBeInstanceOf(InternalServerException);
  });

  it('assertAllowed maps failures to AppExceptions', async () => {
    const fs = makeFs({}, ['D:\\Scan\\gone']);
    const { guard } = makeGuard({ fs });
    await expect(guard.assertAllowed('relative')).rejects.toBeInstanceOf(
      ValidationException,
    );
    await expect(guard.assertAllowed('D:\\Scan\\gone')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(guard.assertAllowed('C:\\Windows')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.assertAllowed('E:\\Other')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard.assertAllowed('D:\\Scan\\app')).resolves.toMatchObject({
      realPath: 'D:\\Scan\\app',
    });
  });

  it('isInsideProtectedTree accepts raw absolute paths', async () => {
    const { guard } = makeGuard();
    expect(await guard.isInsideProtectedTree('C:\\Windows\\System32')).toBe(
      true,
    );
    expect(await guard.isInsideProtectedTree('C:\\Users')).toBe(false);
  });
});

describe('PathGuard denylist junction regressions', () => {
  const makeDataGuard = (fs: ReturnType<typeof makeFs>) =>
    new PathGuard({
      platform: 'win32',
      scanRoots: ALL,
      driveDetector: {
        listFixedDrives: jest.fn(() =>
          Promise.resolve(['C:\\', 'D:\\', 'E:\\']),
        ),
      },
      denylist: buildDenylist({
        platform: 'win32',
        env: {},
        homeDir: 'C:\\Users\\alice',
        appInstallDir: 'D:\\Tools\\PkgSteward\\apps\\api',
        sourceCheckoutDir: 'D:\\Tools\\PkgSteward',
        dataDir: 'D:\\DataLink',
      }),
      fs,
    });

  describe('Scanner pruning with canonical protected paths', () => {
    const makePruningGuard = () =>
      makeDataGuard(
        makeFs({
          'd:\\datalink': 'E:\\Protected\\ActualData',
          'd:\\tools\\pkgsteward\\apps\\api': 'E:\\Protected\\ActualApp',
        }),
      );

    it.each(['E:\\Protected\\ActualData', 'E:\\Protected\\ActualApp'])(
      'prunes the real protected directory %s and its children',
      async (target) => {
        const guard = makePruningGuard();
        expect(await guard.isInsideProtectedTree(target)).toBe(true);
        expect(await guard.isInsideProtectedTree(`${target}\\child`)).toBe(
          true,
        );
      },
    );

    it.each([
      'E:\\Protected',
      'E:\\',
      'C:\\Users',
      'C:\\Users\\alice',
      'C:\\Users\\alice\\Projects',
    ])('still walks into %s', async (target) => {
      expect(await makePruningGuard().isInsideProtectedTree(target)).toBe(
        false,
      );
    });
  });

  it('blocks direct access to the real data directory through a junction', async () => {
    const fs = makeFs({ 'd:\\datalink': 'E:\\ActualData' });
    await expect(
      makeDataGuard(fs).check('E:\\ActualData\\logs'),
    ).resolves.toMatchObject({
      allowed: false,
      code: 'DENYLISTED',
    });
  });

  it('blocks another alias into the real data directory after resolving links', async () => {
    const fs = makeFs({
      'd:\\datalink': 'E:\\ActualData',
      'D:\\Scan\\alias': 'E:\\ActualData\\logs',
    });
    const result = await makeDataGuard(fs).check('D:\\Scan\\alias');
    expect(result).toMatchObject({ allowed: false, code: 'DENYLISTED' });
    expect(result.allowed === false && result.message).toMatch(
      /after resolving links/,
    );
  });

  it('blocks a parent of the real data directory', async () => {
    const fs = makeFs({ 'd:\\datalink': 'E:\\Parent\\ActualData' });
    await expect(makeDataGuard(fs).check('E:\\Parent')).resolves.toMatchObject({
      allowed: false,
      code: 'DENYLISTED',
    });
  });

  describe.each(['E:\\ActualData\\logs', 'D:\\Scan\\alias'])(
    'protected path resolution failures for %s',
    (inputPath) => {
      it.each(['EACCES', 'EIO'])(
        'rejects with InternalServerException when the deny entry realpath returns %s',
        async (code) => {
          const fs = makeFs();
          fs.realpath.mockImplementation((p: string) =>
            p === 'd:\\datalink'
              ? Promise.reject(errno(code))
              : Promise.resolve(
                  p === 'D:\\Scan\\alias' ? 'E:\\ActualData\\logs' : p,
                ),
          );
          const result = makeDataGuard(fs).check(inputPath);
          await expect(result).rejects.toBeInstanceOf(InternalServerException);
          await expect(result).rejects.toThrow('d:\\datalink');
        },
      );
    },
  );

  it('keeps the original deny entry when its realpath returns ENOENT', async () => {
    const fs = makeFs({}, ['d:\\datalink']);
    const guard = makeDataGuard(fs);
    await expect(guard.check('D:\\Scan\\app')).resolves.toMatchObject({
      allowed: true,
    });
    await expect(guard.check('D:\\DataLink\\logs')).resolves.toMatchObject({
      allowed: false,
      code: 'DENYLISTED',
    });
  });
});

describe('PathGuard lstat error regressions', () => {
  it.each(['ENOENT', 'ENOTDIR'])(
    'reports lstat %s as NOT_FOUND after realpath succeeds',
    async (code) => {
      const fs = makeFs();
      fs.lstat.mockRejectedValue(errno(code));
      const { guard } = makeGuard({ fs });
      await expect(guard.check('D:\\Scan\\app')).resolves.toMatchObject({
        allowed: false,
        code: 'NOT_FOUND',
      });
      await expect(guard.assertAllowed('D:\\Scan\\app')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('wraps lstat EACCES in InternalServerException', async () => {
    const fs = makeFs();
    fs.lstat.mockRejectedValue(errno('EACCES'));
    await expect(
      makeGuard({ fs }).guard.check('D:\\Scan\\app'),
    ).rejects.toBeInstanceOf(InternalServerException);
  });
});
