import {
  ForbiddenException,
  InternalServerException,
  NotFoundException,
  ValidationException,
} from '@/common/exceptions/app.exception';
import type { ScanRoots } from '@/config/scan-roots';
import { buildDenylist } from '@/core/path-guard/denylist';
import { PathGuard } from '@/core/path-guard/path-guard';

const denylist = buildDenylist({
  platform: 'win32',
  env: {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramData: 'C:\\ProgramData',
  },
  homeDir: 'C:\\Users\\alice',
  appInstallDir: 'D:\\Tools\\PkgSteward\\pkgsteward_be',
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

describe('PathGuard protected-tree matcher', () => {
  const protectedPath = 'd:\\tools\\pkgsteward\\pkgsteward_be';

  it.each([
    ['C:\\', false],
    ['C:\\Users', false],
    ['C:\\Users\\alice', false],
    ['C:\\Users\\alice\\Projects', false],
    ['D:\\Tools', false],
    ['C:\\Windows', true],
    ['C:\\Windows\\x', true],
    ['E:\\Program Files\\y', true],
    ['D:\\Tools\\PkgSteward\\pkgsteward_be', true],
    ['D:\\Tools\\PkgSteward\\pkgsteward_be\\src', true],
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
    ['/opt/pkgsteward/pkgsteward_be', true],
    ['/opt/pkgsteward/pkgsteward_be/src', true],
    ['/opt/PkgSteward/pkgsteward_be', false],
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
        appInstallDir: '/opt/pkgsteward/pkgsteward_be',
        sourceCheckoutDir: null,
        dataDir: '/home/alice/.local/share/PkgSteward',
      }),
      fs: makeFs({ '/opt/pkgsteward/pkgsteward_be': '/srv/protected/app' }),
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
      const fs = makeFs();
      fs.realpath.mockImplementation((p: string) =>
        p === protectedPath ? Promise.reject(errno(code)) : Promise.resolve(p),
      );
      const matcher = await makeGuard({
        fs,
      }).guard.createProtectedTreeMatcher();

      expect(matcher('D:\\Tools\\PkgSteward\\pkgsteward_be\\src')).toBe(true);
      expect(
        matcher('C:\\Users\\alice\\AppData\\Local\\PkgSteward\\logs'),
      ).toBe(true);
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
    'D:\\Tools\\PkgSteward\\pkgsteward_be\\src',
    'D:\\Tools\\PkgSteward\\pkgsteward_fe',
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
        appInstallDir: 'D:\\Tools\\PkgSteward\\pkgsteward_be',
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
          'd:\\tools\\pkgsteward\\pkgsteward_be': 'E:\\Protected\\ActualApp',
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
