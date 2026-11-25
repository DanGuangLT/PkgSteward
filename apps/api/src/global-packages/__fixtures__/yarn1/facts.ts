import { win32 } from 'node:path';
import type { IGlobalResolvedLocation } from '@/global-packages/interfaces/global-packages.runtime';
import type { IYarnGlobalConfig } from '@/global-packages/interfaces/yarn-global.types';
import {
  TEST_PATHS as P,
  testLocation,
} from '@/global-packages/__fixtures__/global-adapters';

// TEST không phải yêu cầu nghiệp vụ. Inert Windows paths for Yarn 1.x fixtures.
export const YARN_TEST_PATHS = {
  prefix: 'D:\\TEST\\yarn-prefix',
  bin: 'D:\\TEST\\yarn-prefix\\bin',
  global: 'D:\\TEST\\yarn-data\\global',
  root: 'D:\\TEST\\yarn-data\\global\\node_modules',
  cache: 'D:\\TEST\\yarn-cache',
  mutex: 'D:\\TEST\\data\\cache\\yarn-global.mutex',
  userYarnrc: 'D:\\TEST\\profile\\.yarnrc',
  globalYarnrc: 'D:\\TEST\\yarn-prefix\\etc\\yarnrc',
  userNpmrc: 'D:\\TEST\\profile\\.npmrc',
  globalNpmrc: 'D:\\TEST\\yarn-prefix\\etc\\npmrc',
  profile: 'D:\\TEST\\profile',
  local: 'D:\\TEST\\local',
} as const;

export const yarnConfigFacts = (
  patch: Partial<IYarnGlobalConfig> = {},
): IYarnGlobalConfig => ({
  prefixDir: YARN_TEST_PATHS.prefix,
  globalDir: YARN_TEST_PATHS.global,
  globalRoot: YARN_TEST_PATHS.root,
  binDir: YARN_TEST_PATHS.bin,
  cacheDir: YARN_TEST_PATHS.cache,
  mutexFile: YARN_TEST_PATHS.mutex,
  userYarnrc: YARN_TEST_PATHS.userYarnrc,
  globalYarnrc: YARN_TEST_PATHS.globalYarnrc,
  userNpmrc: YARN_TEST_PATHS.userNpmrc,
  globalNpmrc: YARN_TEST_PATHS.globalNpmrc,
  binOnPath: true,
  explicitPrefix: false,
  originalPath: [YARN_TEST_PATHS.bin, 'C:\\Program Files\\nodejs'],
  selectors: { userprofile: YARN_TEST_PATHS.profile },
  configIdentities: [],
  missingConfigPaths: [
    YARN_TEST_PATHS.userYarnrc,
    YARN_TEST_PATHS.globalYarnrc,
    YARN_TEST_PATHS.userNpmrc,
    YARN_TEST_PATHS.globalNpmrc,
  ],
  directoryIdentities: [],
  missingDirectoryPaths: [],
  policy: {
    defaultRegistry: 'public',
    scopedRegistries: [],
    unknownRouting: false,
    publicAuthPresent: false,
    changeUnsupported: false,
  },
  ...patch,
});

export const yarnLocation = (
  config: IYarnGlobalConfig = yarnConfigFacts(),
  version = '1.22.22',
): IGlobalResolvedLocation => ({
  ...testLocation('yarn', version),
  prefix: config.prefixDir,
  globalDir: config.globalDir,
  globalRoot: config.globalRoot,
  binDir: config.binDir,
  cacheDir: config.cacheDir,
  storeDir: null,
  userConfig: config.userYarnrc,
  globalConfig: config.globalYarnrc,
  configIdentities: [...config.configIdentities],
  missingConfigPaths: [...config.missingConfigPaths],
  yarn: config,
  protectedPaths: [P.yarn, P.npm, P.pnpm, P.node, P.app, P.source, P.data],
});

export const yarnBinCmdPath = (binName: string, binDir = YARN_TEST_PATHS.bin) =>
  win32.join(binDir, `${binName}.cmd`);
