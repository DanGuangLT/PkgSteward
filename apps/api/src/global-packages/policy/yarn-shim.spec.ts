import 'reflect-metadata';
import { win32 } from 'node:path';
import {
  proveYarnBinSet,
  proveYarnGlobalWrapperShim,
  proveYarnLocalBinShim,
  readYarnBinDirectory,
} from '@/global-packages/policy/yarn-shim';
import {
  memoryFs,
  TEST_PATHS as P,
} from '@/global-packages/__fixtures__/global-adapters';
import { YARN_TEST_PATHS as Y } from '@/global-packages/__fixtures__/yarn1/facts';
import {
  yarnGlobalBinShims,
  yarnLocalBinShims,
} from '@/global-packages/__fixtures__/yarn1/shims';

describe('yarn-shim verification', () => {
  const globalDotBinDir = win32.join(Y.root, '.bin');
  const targetFile = win32.join(Y.root, 'semver', 'bin', 'semver.js');

  it('proves exact Yarn Classic global wrapper shims (.cmd and POSIX) and local .bin shims', () => {
    const globalShims = yarnGlobalBinShims(Y.bin, globalDotBinDir, 'semver');
    expect(
      proveYarnGlobalWrapperShim({
        text: globalShims.cmdText,
        shimPath: globalShims.cmdPath,
        binDir: Y.bin,
        globalDotBinDir,
        binName: 'semver',
      }),
    ).toBe(true);
    expect(
      proveYarnGlobalWrapperShim({
        text: globalShims.shText,
        shimPath: globalShims.shPath,
        binDir: Y.bin,
        globalDotBinDir,
        binName: 'semver',
      }),
    ).toBe(true);

    const localShims = yarnLocalBinShims(globalDotBinDir, 'semver', targetFile);
    expect(
      proveYarnLocalBinShim({
        text: localShims.cmdText,
        shimPath: localShims.cmdPath,
        globalDotBinDir,
        targetFile,
      }),
    ).toBe(true);
    expect(
      proveYarnLocalBinShim({
        text: localShims.shText,
        shimPath: localShims.shPath,
        globalDotBinDir,
        targetFile,
      }),
    ).toBe(true);
  });

  it('rejects command injection or wrong target in wrapper or local shims', () => {
    const globalShims = yarnGlobalBinShims(Y.bin, globalDotBinDir, 'semver');
    expect(
      proveYarnGlobalWrapperShim({
        text: `${globalShims.cmdText}& calc.exe\r\n`,
        shimPath: globalShims.cmdPath,
        binDir: Y.bin,
        globalDotBinDir,
        binName: 'semver',
      }),
    ).toBe(false);
    expect(
      proveYarnGlobalWrapperShim({
        text: globalShims.shText.replace('/semver"', '/evil" && whoami'),
        shimPath: globalShims.shPath,
        binDir: Y.bin,
        globalDotBinDir,
        binName: 'semver',
      }),
    ).toBe(false);
    const localShims = yarnLocalBinShims(globalDotBinDir, 'semver', targetFile);
    expect(
      proveYarnLocalBinShim({
        text: localShims.cmdText.replace('semver.js', 'other.js'),
        shimPath: localShims.cmdPath,
        globalDotBinDir,
        targetFile,
      }),
    ).toBe(false);
  });

  it('proves a clean 2-file Yarn bin set and refuses colliding extra extensions (.ps1 / foreign)', async () => {
    const mem = memoryFs();
    const globalShims = yarnGlobalBinShims(Y.bin, globalDotBinDir, 'semver');
    mem.put(Y.bin, { directory: true });
    mem.put(globalShims.cmdPath, { text: globalShims.cmdText });
    mem.put(globalShims.shPath, { text: globalShims.shText });
    mem.readdir.mockImplementation((dir: string) =>
      Promise.resolve(
        dir.toLowerCase() === Y.bin.toLowerCase()
          ? ['semver', 'semver.cmd']
          : [],
      ),
    );
    const dir = await readYarnBinDirectory({
      fs: mem.fs,
      signal: new AbortController().signal,
      binDir: Y.bin,
      budget: { remaining: 1024 * 1024 },
    });
    const proven = proveYarnBinSet({
      directory: dir,
      binDir: Y.bin,
      globalDotBinDir,
      binName: 'semver',
      nodePath: P.node,
    });
    expect(proven).toHaveLength(2);

    // Adding an extra colliding semver.ps1 makes ownership ambiguous -> null
    mem.put(win32.join(Y.bin, 'semver.ps1'), { text: '#!/usr/bin/env pwsh' });
    mem.readdir.mockResolvedValue(['semver', 'semver.cmd', 'semver.ps1']);
    const conflicted = await readYarnBinDirectory({
      fs: mem.fs,
      signal: new AbortController().signal,
      binDir: Y.bin,
      budget: { remaining: 1024 * 1024 },
    });
    expect(
      proveYarnBinSet({
        directory: conflicted,
        binDir: Y.bin,
        globalDotBinDir,
        binName: 'semver',
        nodePath: P.node,
      }),
    ).toBeNull();
  });

  it('supports valid dotted bin names like foo.bar across readYarnBinDirectory, local and global shims', async () => {
    const dottedTarget = win32.join(Y.root, 'foo', 'bin', 'foo.bar.js');
    const local = yarnLocalBinShims(globalDotBinDir, 'foo.bar', dottedTarget);
    const global = yarnGlobalBinShims(Y.bin, globalDotBinDir, 'foo.bar');
    expect(
      proveYarnLocalBinShim({
        text: local.shText,
        shimPath: local.shPath,
        globalDotBinDir,
        targetFile: dottedTarget,
        binName: 'foo.bar',
      }),
    ).toBe(true);
    expect(
      proveYarnGlobalWrapperShim({
        text: global.shText,
        shimPath: global.shPath,
        binDir: Y.bin,
        globalDotBinDir,
        binName: 'foo.bar',
      }),
    ).toBe(true);
    const mem = memoryFs();
    mem.put(Y.bin, { directory: true });
    mem.put(global.cmdPath, { text: global.cmdText });
    mem.put(global.shPath, { text: global.shText });
    mem.readdir.mockResolvedValue(['foo.bar', 'foo.bar.cmd']);
    const dir = await readYarnBinDirectory({
      fs: mem.fs,
      signal: new AbortController().signal,
      binDir: Y.bin,
      budget: { remaining: 1024 * 1024 },
    });
    expect(
      proveYarnBinSet({
        directory: dir,
        binDir: Y.bin,
        globalDotBinDir,
        binName: 'foo.bar',
        nodePath: P.node,
      }),
    ).toHaveLength(2);
  });
});
