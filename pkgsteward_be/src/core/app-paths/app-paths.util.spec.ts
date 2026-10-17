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
    const pkg = join(tmp, 'pkgsteward_be');
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

  it('findSourceCheckoutDir returns the parent when it holds .git', () => {
    mkdirSync(join(tmp, '.git'));
    const be = join(tmp, 'pkgsteward_be');
    mkdirSync(be);
    expect(findSourceCheckoutDir(be)).toBe(tmp);
  });

  it('findSourceCheckoutDir returns null for an installed package', () => {
    const be = join(tmp, 'node_modules', 'pkgsteward');
    mkdirSync(be, { recursive: true });
    expect(findSourceCheckoutDir(be)).toBeNull();
  });
});
