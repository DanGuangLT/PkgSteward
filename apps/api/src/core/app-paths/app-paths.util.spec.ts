import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  findPackageRoot,
  findSourceCheckoutDir,
  resolveDataDir,
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

  it('falls back to <home>\\AppData\\Local when LOCALAPPDATA is missing', () => {
    expect(resolveDataDir({ ...win, localAppData: undefined })).toBe(
      'C:\\Users\\alice\\AppData\\Local\\PkgSteward',
    );
  });

  it('uses ~/.local/share/PkgSteward on other platforms', () => {
    expect(resolveDataDir({ homeDir: '/home/alice', platform: 'linux' })).toBe(
      '/home/alice/.local/share/PkgSteward',
    );
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
