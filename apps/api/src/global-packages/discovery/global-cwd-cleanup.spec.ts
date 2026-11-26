import 'reflect-metadata';
import {
  isProcessAlive,
  removeOwnGlobalCwd,
  sweepStaleGlobalCwds,
} from '@/global-packages/discovery/global-cwd-cleanup';
import type { IGlobalCwdCleanupDeps } from '@/global-packages/discovery/global-cwd-cleanup';
import { resolveGlobalProbeCwd } from '@/global-packages/discovery/global-location';

const dir = { isDirectory: () => true, isSymbolicLink: () => false };

const makeDeps = (
  names: string[],
  alive: (pid: number) => boolean,
  stat = dir,
) => {
  const rm = jest.fn().mockResolvedValue(undefined);
  const deps: IGlobalCwdCleanupDeps = {
    readdir: jest.fn().mockResolvedValue(names),
    lstat: jest.fn().mockResolvedValue(stat),
    rm,
    isProcessAlive: alive,
  };
  return { deps, rm };
};

describe('isProcessAlive', () => {
  afterEach(() => jest.restoreAllMocks());

  it('treats EPERM as alive and only ESRCH as dead', () => {
    const spy = jest.spyOn(process, 'kill');
    spy.mockImplementationOnce(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });
    expect(isProcessAlive(123)).toBe(true);

    spy.mockImplementationOnce(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });
    expect(isProcessAlive(123)).toBe(false);
  });
});

describe('sweepStaleGlobalCwds', () => {
  it('removes only dead-PID folders matching the exact name', async () => {
    const { deps, rm } = makeDeps(
      [
        'pkgsteward-global-cwd-100',
        'pkgsteward-global-cwd-200',
        'pkgsteward-global-cwd-300',
        'pkgsteward-global-cwd-abc',
        'other',
      ],
      (pid) => pid === 200,
    );
    await sweepStaleGlobalCwds('C:\\Temp', 300, deps);
    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith('C:\\Temp\\pkgsteward-global-cwd-100', {
      recursive: true,
      force: true,
    });
  });

  it('refuses symlinked tempBase, symlinked entries, files, and swallows errors', async () => {
    const symBaseReaddir = jest
      .fn()
      .mockResolvedValue(['pkgsteward-global-cwd-100']);
    const symBaseRm = jest.fn();
    const symBase: IGlobalCwdCleanupDeps = {
      readdir: symBaseReaddir,
      lstat: jest.fn().mockResolvedValue({
        isDirectory: () => true,
        isSymbolicLink: () => true,
      }),
      rm: symBaseRm,
      isProcessAlive: () => false,
    };
    await sweepStaleGlobalCwds('C:\\Temp', 1, symBase);
    expect(symBaseReaddir).not.toHaveBeenCalled();
    expect(symBaseRm).not.toHaveBeenCalled();

    const symChildRm = jest.fn();
    const symChild: IGlobalCwdCleanupDeps = {
      readdir: jest.fn().mockResolvedValue(['pkgsteward-global-cwd-100']),
      lstat: jest
        .fn()
        .mockResolvedValueOnce(dir)
        .mockResolvedValueOnce({
          isDirectory: () => true,
          isSymbolicLink: () => true,
        }),
      rm: symChildRm,
      isProcessAlive: () => false,
    };
    await sweepStaleGlobalCwds('C:\\Temp', 1, symChild);
    expect(symChildRm).not.toHaveBeenCalled();

    const fileChildRm = jest.fn();
    const fileChild: IGlobalCwdCleanupDeps = {
      readdir: jest.fn().mockResolvedValue(['pkgsteward-global-cwd-100']),
      lstat: jest
        .fn()
        .mockResolvedValueOnce(dir)
        .mockResolvedValueOnce({
          isDirectory: () => false,
          isSymbolicLink: () => false,
        }),
      rm: fileChildRm,
      isProcessAlive: () => false,
    };
    await sweepStaleGlobalCwds('C:\\Temp', 1, fileChild);
    expect(fileChildRm).not.toHaveBeenCalled();

    const failing = makeDeps(['pkgsteward-global-cwd-100'], () => false);
    failing.rm.mockRejectedValue(new Error('EBUSY'));
    await expect(
      sweepStaleGlobalCwds('C:\\Temp', 1, failing.deps),
    ).resolves.toBeUndefined();
  });
});

describe('removeOwnGlobalCwd', () => {
  it('removes only real temp cwd directories and refuses symlinks', async () => {
    const rm = jest.fn().mockResolvedValue(undefined);
    const lstat = jest
      .fn()
      .mockResolvedValueOnce(dir)
      .mockResolvedValueOnce({
        isDirectory: () => true,
        isSymbolicLink: () => true,
      });
    await removeOwnGlobalCwd('C:\\Temp\\pkgsteward-global-cwd-5', {
      lstat,
      rm,
    });
    await removeOwnGlobalCwd('C:\\Temp\\pkgsteward-global-cwd-6', {
      lstat,
      rm,
    });
    await removeOwnGlobalCwd('D:\\data\\cache\\global-packages-cwd', {
      lstat,
      rm,
    });
    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith('C:\\Temp\\pkgsteward-global-cwd-5', {
      recursive: true,
      force: true,
    });
  });
});

describe('resolveGlobalProbeCwd', () => {
  const paths = (cacheDir: string) => ({
    cacheDir,
    appInstallDir: 'D:\\repo\\apps\\api',
    sourceCheckoutDir: 'D:\\repo',
    appRootDir: 'D:\\repo',
    portableBaseDir: null,
    dataDir: cacheDir.replace(/\\cache$/, ''),
  });

  it('uses the cache folder outside the app tree', () => {
    expect(
      resolveGlobalProbeCwd({
        paths: paths('C:\\Users\\a\\AppData\\Local\\PkgSteward\\cache'),
        environment: {},
      }),
    ).toBe(
      'C:\\Users\\a\\AppData\\Local\\PkgSteward\\cache\\global-packages-cwd',
    );
  });

  it('uses a per-process temp folder inside the checkout, appRootDir, or portableBaseDir (case-insensitive TEMP/TMP)', () => {
    expect(
      resolveGlobalProbeCwd({
        paths: paths('D:\\repo\\PkgStewardLog\\cache'),
        environment: { Temp: 'C:\\Temp' },
        pid: 42,
      }),
    ).toBe('C:\\Temp\\pkgsteward-global-cwd-42');

    expect(
      resolveGlobalProbeCwd({
        paths: {
          cacheDir: 'E:\\Portable\\PkgStewardLog\\cache',
          appInstallDir: 'C:\\ReadOnly\\apps\\api',
          sourceCheckoutDir: null,
          appRootDir: 'C:\\ReadOnly',
          portableBaseDir: 'E:\\Portable',
          dataDir: 'E:\\Portable\\PkgStewardLog',
        },
        environment: { tmp: 'C:\\Tmp' },
        pid: 99,
      }),
    ).toBe('C:\\Tmp\\pkgsteward-global-cwd-99');
  });

  it('fails closed with CONFIG_UNSUPPORTED when TEMP/TMP are missing, relative, or inside the app tree', () => {
    for (const environment of [
      {},
      { TEMP: '   ' },
      { TEMP: 'tmp' },
      { TEMP: 'D:\\repo\\tmp' },
    ]) {
      let caught: unknown;
      try {
        resolveGlobalProbeCwd({
          paths: paths('D:\\repo\\PkgStewardLog\\cache'),
          environment,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        details: { reason: 'CONFIG_UNSUPPORTED' },
      });
    }
  });
});
