import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  detectPortableMode,
  findAppRootDir,
  findPackageRoot,
  findSourceCheckoutDir,
  resolveAppDataDir,
  resolveDataDir,
  wrapDataDirWriteError,
} from '@/core/app-paths/app-paths.util';

describe('resolveDataDir', () => {
  const win = {
    localAppData: 'C:\\Users\\alice\\AppData\\Local',
    homeDir: 'C:\\Users\\alice',
    platform: 'win32' as const,
  };

  it('uses PKGSTEWARD_DATA_DIR when it is set', () => {
    expect(resolveDataDir({ ...win, override: 'D:\\pkg-data\\' })).toBe(
      'D:\\pkg-data',
    );
  });

  it('ignores a blank PKGSTEWARD_DATA_DIR', () => {
    expect(resolveDataDir({ ...win, override: '   ' })).toBe(
      'C:\\Users\\alice\\AppData\\Local\\PkgSteward',
    );
  });

  it('defaults to %LOCALAPPDATA%\\PkgSteward on Windows', () => {
    expect(resolveDataDir(win)).toBe(
      'C:\\Users\\alice\\AppData\\Local\\PkgSteward',
    );
  });

  it('falls back to %APPDATA%\\PkgSteward then <home>\\AppData\\Local\\PkgSteward on Windows', () => {
    expect(
      resolveDataDir({
        ...win,
        localAppData: undefined,
        appData: 'C:\\Users\\alice\\AppData\\Roaming',
      }),
    ).toBe('C:\\Users\\alice\\AppData\\Roaming\\PkgSteward');
    expect(resolveDataDir({ ...win, localAppData: undefined })).toBe(
      'C:\\Users\\alice\\AppData\\Local\\PkgSteward',
    );
  });

  it('uses ~/Library/Application Support/PkgSteward on macOS', () => {
    expect(
      resolveDataDir({ homeDir: '/Users/alice', platform: 'darwin' }),
    ).toBe('/Users/alice/Library/Application Support/PkgSteward');
  });

  it('uses $XDG_DATA_HOME/PkgSteward or ~/.local/share/PkgSteward on Linux', () => {
    expect(
      resolveDataDir({
        homeDir: '/home/alice',
        platform: 'linux',
        xdgDataHome: '/var/lib/xdg',
      }),
    ).toBe('/var/lib/xdg/PkgSteward');
    expect(
      resolveDataDir({
        homeDir: '/home/alice',
        platform: 'linux',
        xdgDataHome: 'relative/xdg',
      }),
    ).toBe('/home/alice/.local/share/PkgSteward');
    expect(resolveDataDir({ homeDir: '/home/alice', platform: 'linux' })).toBe(
      '/home/alice/.local/share/PkgSteward',
    );
  });
});

describe('findAppRootDir & detectPortableMode', () => {
  it('prefers sourceCheckoutDir, then packaged monorepo root, then appInstallDir', () => {
    expect(
      findAppRootDir('D:\\Repo\\apps\\api', 'D:\\Repo', () => false, 'win32'),
    ).toBe('D:\\Repo');
    expect(
      findAppRootDir(
        'D:\\Pkg\\APPS\\api',
        null,
        (filePath) => filePath.toLowerCase() === 'd:\\pkg\\package.json',
        'win32',
      ),
    ).toBe('D:\\Pkg');
    expect(
      findAppRootDir('D:\\Standalone\\api', null, () => false, 'win32'),
    ).toBe('D:\\Standalone\\api');
  });

  it('detects portable mode from valid PORTABLE_EXECUTABLE_DIR or portable.flag', () => {
    expect(
      detectPortableMode({
        appRootDir: 'D:\\Pkg',
        appInstallDir: 'D:\\Pkg\\apps\\api',
        env: { PORTABLE_EXECUTABLE_DIR: 'E:\\Portable\\App' },
        platform: 'win32',
        exists: () => false,
      }),
    ).toEqual({ portable: true, baseDir: 'E:\\Portable\\App' });

    expect(
      detectPortableMode({
        appRootDir: 'D:\\Pkg',
        appInstallDir: 'D:\\Pkg\\apps\\api',
        env: {},
        platform: 'win32',
        exists: (p) => p === 'D:\\Pkg\\apps\\api\\portable.flag',
      }),
    ).toEqual({ portable: true, baseDir: 'D:\\Pkg' });

    expect(
      detectPortableMode({
        appRootDir: 'D:\\Pkg',
        appInstallDir: 'D:\\Pkg\\apps\\api',
        env: {},
        platform: 'win32',
        exists: () => false,
      }),
    ).toEqual({ portable: false, baseDir: null });
  });

  it.each(['relative', 'C:foo', '\\foo', '\\\\server\\share'])(
    'rejects invalid PORTABLE_EXECUTABLE_DIR %s fail-closed',
    (bad) => {
      expect(() =>
        detectPortableMode({
          appRootDir: 'D:\\Pkg',
          appInstallDir: 'D:\\Pkg\\apps\\api',
          env: { PORTABLE_EXECUTABLE_DIR: bad },
          platform: 'win32',
          exists: () => false,
        }),
      ).toThrow(/PORTABLE_EXECUTABLE_DIR/);
    },
  );
});

describe('resolveAppDataDir (3-tier priority)', () => {
  const baseWin = {
    appInstallDir: 'D:\\Repo\\apps\\api',
    appRootDir: 'D:\\Repo',
    sourceCheckoutDir: 'D:\\Repo',
    env: { LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local' },
    homeDir: 'C:\\Users\\alice',
    platform: 'win32' as const,
    exists: () => false,
  };

  it('Tier 1: explicit absolute override wins over checkout and portable markers', () => {
    expect(
      resolveAppDataDir({
        ...baseWin,
        override: 'E:\\CustomData\\',
        env: { ...baseWin.env, PORTABLE_EXECUTABLE_DIR: 'F:\\Portable' },
      }),
    ).toEqual({
      dataDir: 'E:\\CustomData',
      tier: 'explicit',
      portableBaseDir: 'F:\\Portable',
    });
  });

  it('Tier 2: unset override resolves co-located PkgStewardLog in checkout or portable mode', () => {
    expect(resolveAppDataDir(baseWin)).toEqual({
      dataDir: 'D:\\Repo\\PkgStewardLog',
      tier: 'co-located',
      portableBaseDir: null,
    });
    expect(
      resolveAppDataDir({
        ...baseWin,
        sourceCheckoutDir: null,
        appInstallDir: 'C:\\Program Files\\PkgSteward',
        appRootDir: 'C:\\Program Files\\PkgSteward',
        env: { ...baseWin.env, PORTABLE_EXECUTABLE_DIR: 'E:\\USB\\Pkg' },
      }),
    ).toEqual({
      dataDir: 'E:\\USB\\Pkg\\PkgStewardLog',
      tier: 'co-located',
      portableBaseDir: 'E:\\USB\\Pkg',
    });
  });

  it('Tier 2: relative override resolves against co-located base dir', () => {
    expect(resolveAppDataDir({ ...baseWin, override: '../SharedLog' })).toEqual(
      {
        dataDir: 'D:\\SharedLog',
        tier: 'explicit',
        portableBaseDir: null,
      },
    );
  });

  it('Tier 3: standard packaged / npx layout falls back to OS user data dir', () => {
    expect(
      resolveAppDataDir({
        ...baseWin,
        sourceCheckoutDir: null,
        appInstallDir: 'C:\\Program Files\\PkgSteward',
        appRootDir: 'C:\\Program Files\\PkgSteward',
      }),
    ).toEqual({
      dataDir: 'C:\\Users\\alice\\AppData\\Local\\PkgSteward',
      tier: 'os-user',
      portableBaseDir: null,
    });
  });

  it('Tier 3: rejects relative override when no project/portable folder exists', () => {
    expect(() =>
      resolveAppDataDir({
        ...baseWin,
        sourceCheckoutDir: null,
        appInstallDir: 'C:\\Program Files\\PkgSteward',
        appRootDir: 'C:\\Program Files\\PkgSteward',
        override: 'logs',
      }),
    ).toThrow(/no project folder/);
  });

  it.each(['C:data', '\\data', '/data', '\\\\server\\share'])(
    'rejects ambiguous override %s',
    (bad) => {
      expect(() => resolveAppDataDir({ ...baseWin, override: bad })).toThrow(
        /PKGSTEWARD_DATA_DIR/,
      );
    },
  );
});

describe('wrapDataDirWriteError', () => {
  it('wraps permission/read-only errors with actionable dataDir guidance', () => {
    const err = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    const wrapped = wrapDataDirWriteError(
      'C:\\Program Files\\PkgStewardLog',
      'C:\\Program Files\\PkgStewardLog\\logs',
      err,
    );
    expect(wrapped.message).toMatch(/PKGSTEWARD_DATA_DIR/);
    expect(wrapped.message).toContain('C:\\Program Files\\PkgStewardLog');
    expect(wrapped.message).toContain('EACCES');
  });
});

describe('package folders', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pkgsteward-paths-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('findPackageRoot walks up to the nearest folder with package.json', () => {
    const pkg = join(tmp, 'apps', 'api');
    const deep = join(pkg, 'dist', 'core', 'app-paths');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), '{}');
    expect(findPackageRoot(deep)).toBe(pkg);
  });

  it('findPackageRoot throws when no package.json exists above', () => {
    expect(() => findPackageRoot(join(tmp, 'x'), () => false)).toThrow(
      /package\.json/,
    );
  });

  it('findSourceCheckoutDir returns the repository two levels above apps/<app>', () => {
    mkdirSync(join(tmp, '.git'));
    const be = join(tmp, 'apps', 'api');
    mkdirSync(be, { recursive: true });
    expect(findSourceCheckoutDir(be)).toBe(tmp);
  });

  it('findSourceCheckoutDir ignores the case of the apps folder name', () => {
    // On Windows __dirname keeps the case typed in the shell (e.g. cd ...\APPS\api).
    mkdirSync(join(tmp, '.git'));
    mkdirSync(join(tmp, 'apps', 'api'), { recursive: true });
    expect(findSourceCheckoutDir(join(tmp, 'APPS', 'api'))).toBe(tmp);
  });

  it.each([
    ['a flat <repo>/<app> layout', ['api']],
    ['a parent not named apps', ['tools', 'api']],
    ['an install inside another repository', ['node_modules', 'pkgsteward']],
  ])('findSourceCheckoutDir returns null for %s', (_label, segments) => {
    // .git two levels up must not count unless the layout is <repo>/apps/<app>.
    mkdirSync(join(tmp, '.git'));
    const be = join(tmp, ...segments);
    mkdirSync(be, { recursive: true });
    expect(findSourceCheckoutDir(be)).toBeNull();
  });

  it('findSourceCheckoutDir returns null for an installed package', () => {
    const be = join(tmp, 'node_modules', 'pkgsteward');
    mkdirSync(be, { recursive: true });
    expect(findSourceCheckoutDir(be)).toBeNull();
  });
});
