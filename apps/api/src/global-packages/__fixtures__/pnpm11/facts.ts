import type { IPnpmGlobalConfig } from '@/global-packages/interfaces/pnpm-global.types';
import type { IGlobalResolvedLocation } from '@/global-packages/interfaces/global-packages.runtime';
import { testLocation } from '@/global-packages/__fixtures__/global-adapters';

// TEST không phải yêu cầu nghiệp vụ. Inert Windows paths, never the host environment.
export const PNPM_TEST_PATHS = {
  home: 'D:\\TEST\\pnpm-home',
  global: 'D:\\TEST\\pnpm-global',
  root: 'D:\\TEST\\pnpm-global\\v11',
  bin: 'D:\\TEST\\pnpm-bin',
  store: 'D:\\TEST\\pnpm-store\\v11',
  cache: 'D:\\TEST\\pnpm-cache',
  state: 'D:\\TEST\\pnpm-state',
  config: 'D:\\TEST\\xdg\\pnpm',
  yaml: 'D:\\TEST\\xdg\\pnpm\\config.yaml',
  auth: 'D:\\TEST\\config\\auth.npmrc',
  profile: 'D:\\TEST\\profile',
  local: 'D:\\TEST\\local',
} as const;

export const pnpmConfigFacts = (
  patch: Partial<IPnpmGlobalConfig> = {},
): IPnpmGlobalConfig => ({
  homeDir: PNPM_TEST_PATHS.home,
  globalDir: PNPM_TEST_PATHS.global,
  globalRoot: PNPM_TEST_PATHS.root,
  binDir: PNPM_TEST_PATHS.bin,
  storeDir: PNPM_TEST_PATHS.store,
  cacheDir: PNPM_TEST_PATHS.cache,
  stateDir: PNPM_TEST_PATHS.state,
  configDir: PNPM_TEST_PATHS.config,
  authFile: PNPM_TEST_PATHS.auth,
  originalPath: [PNPM_TEST_PATHS.bin, 'C:\\Program Files\\nodejs'],
  configIdentities: [],
  missingConfigPaths: [],
  missingDirectoryPaths: [],
  directoryIdentities: [],
  selectors: { PNPM_HOME: PNPM_TEST_PATHS.home },
  policy: {
    defaultRegistry: 'public',
    scopedRegistries: [],
    unknownRouting: false,
    publicAuthPresent: false,
    changeUnsupported: false,
  },
  safety: {},
  ...patch,
});

export const pnpmLocation = (
  config: IPnpmGlobalConfig = pnpmConfigFacts(),
): IGlobalResolvedLocation => ({
  ...testLocation('pnpm'),
  globalDir: config.globalDir,
  globalRoot: config.globalRoot,
  binDir: config.binDir,
  storeDir: config.storeDir,
  cacheDir: config.cacheDir,
  userConfig: config.authFile,
  pnpm: config,
});
