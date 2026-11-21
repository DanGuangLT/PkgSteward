import { win32 } from 'node:path';
import type { IRunnerTool } from '@/npm-runner/interfaces/npm-runner.types';
import type { IPnpmGlobalConfig } from '@/global-packages/interfaces/pnpm-global.types';
import type { IGlobalResolvedLocation } from '@/global-packages/interfaces/global-packages.runtime';
import {
  TEST_PATHS,
  testLocation,
} from '@/global-packages/__fixtures__/global-adapters';
import { testIdentity } from '@/global-packages/__fixtures__/global-lifecycle';
import {
  PNPM_TEST_PATHS,
  pnpmConfigFacts,
} from '@/global-packages/__fixtures__/pnpm11/facts';

// TEST không phải yêu cầu nghiệp vụ. Inert Windows paths for pnpm 12.x native binary.
export const PNPM12_EXE = win32.join(TEST_PATHS.pnpm, 'pnpm.exe');

export const pnpm12Tool = (version = '12.21.0'): IRunnerTool => ({
  manager: 'pnpm',
  version,
  file: PNPM12_EXE,
  entry: null,
  packageDir: TEST_PATHS.pnpm,
  identities: [
    testIdentity(TEST_PATHS.node),
    testIdentity(win32.join(TEST_PATHS.pnpm, 'package.json')),
    testIdentity(PNPM12_EXE),
    {
      ...testIdentity(TEST_PATHS.pnpm),
      stat: {
        ...testIdentity(TEST_PATHS.pnpm).stat,
        isFile: () => false,
        isDirectory: () => true,
      },
    },
  ],
});

export const pnpm12Location = (
  config: IPnpmGlobalConfig = pnpmConfigFacts(),
  version = '12.21.0',
): IGlobalResolvedLocation => ({
  ...testLocation('pnpm', version),
  tool: pnpm12Tool(version),
  globalDir: config.globalDir,
  globalRoot: config.globalRoot,
  binDir: config.binDir,
  storeDir: config.storeDir,
  cacheDir: config.cacheDir,
  userConfig: config.authFile,
  pnpm: config,
});

export { PNPM_TEST_PATHS as PNPM12_TEST_PATHS, pnpmConfigFacts };
