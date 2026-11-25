import 'reflect-metadata';
import { readYarnGlobalConfig } from '@/global-packages/config/yarn-global-config';
import type { IYarnGlobalConfigDeps } from '@/global-packages/config/yarn-global-config';
import {
  expectGlobalReason,
  memoryFs,
  testTool,
  TEST_PATHS as P,
} from '@/global-packages/__fixtures__/global-adapters';

const YARN_DEPS_PATHS = {
  profile: 'D:\\TEST\\profile',
  localAppData: 'D:\\TEST\\local',
  appData: 'D:\\TEST\\roaming',
  defaultPrefix: 'D:\\TEST\\local\\Yarn',
  defaultGlobalDir: 'D:\\TEST\\local\\Yarn\\Data\\global',
  defaultBinDir: 'D:\\TEST\\local\\Yarn\\bin',
  defaultCacheDir: 'D:\\TEST\\local\\Yarn\\Cache',
  customPrefix: 'D:\\TEST\\YarnPrefix',
  customGlobalDir: 'D:\\TEST\\YarnData\\global',
  customCacheDir: 'D:\\TEST\\YarnCache',
  dataDir: 'D:\\TEST\\data',
} as const;

const buildDeps = (
  environment: NodeJS.ProcessEnv = {},
  patch: Partial<IYarnGlobalConfigDeps> = {},
) => {
  const mem = memoryFs();
  mem.put(P.cwd, { directory: true });
  const deps: IYarnGlobalConfigDeps = {
    fs: mem.fs,
    signal: new AbortController().signal,
    tool: testTool('yarn', '1.22.22'),
    cwd: P.cwd,
    dataDir: YARN_DEPS_PATHS.dataDir,
    environment: {
      USERPROFILE: YARN_DEPS_PATHS.profile,
      LOCALAPPDATA: YARN_DEPS_PATHS.localAppData,
      APPDATA: YARN_DEPS_PATHS.appData,
      PATH: `${YARN_DEPS_PATHS.defaultBinDir};C:\\Program Files\\nodejs`,
      ...environment,
    },
    checkDirectory: () => Promise.resolve(),
    ...patch,
  };
  return { ...mem, deps };
};

describe('readYarnGlobalConfig', () => {
  it('resolves Windows default Yarn Classic paths when no rc overrides exist', async () => {
    const { put, deps } = buildDeps();
    put(YARN_DEPS_PATHS.defaultBinDir, { directory: true });
    put(YARN_DEPS_PATHS.defaultGlobalDir, { directory: true });
    put(`${YARN_DEPS_PATHS.defaultGlobalDir}\\node_modules`, {
      directory: true,
    });
    put(YARN_DEPS_PATHS.defaultCacheDir, { directory: true });

    const config = await readYarnGlobalConfig(deps);
    expect(config).toMatchObject({
      prefixDir: YARN_DEPS_PATHS.defaultPrefix,
      globalDir: YARN_DEPS_PATHS.defaultGlobalDir,
      globalRoot: `${YARN_DEPS_PATHS.defaultGlobalDir}\\node_modules`,
      binDir: YARN_DEPS_PATHS.defaultBinDir,
      cacheDir: YARN_DEPS_PATHS.defaultCacheDir,
      mutexFile: `${YARN_DEPS_PATHS.dataDir}\\cache\\yarn-global.mutex`,
      binOnPath: true,
      explicitPrefix: false,
      policy: {
        defaultRegistry: null,
        scopedRegistries: [],
        unknownRouting: false,
        publicAuthPresent: false,
        changeUnsupported: false,
      },
    });
    expect(config.missingConfigPaths).toContain(
      `${YARN_DEPS_PATHS.profile}\\.yarnrc`,
    );
  });

  it('parses .yarnrc paths, comments and flags without spawning', async () => {
    const { put, deps } = buildDeps({
      PATH: 'C:\\Program Files\\nodejs',
    });
    put(`${YARN_DEPS_PATHS.profile}\\.yarnrc`, {
      text: [
        '# Yarn Classic rc',
        `prefix "${YARN_DEPS_PATHS.customPrefix.replace(/\\/g, '\\\\')}"`,
        `--global-folder "${YARN_DEPS_PATHS.customGlobalDir.replace(/\\/g, '\\\\')}"`,
        `cache-folder "${YARN_DEPS_PATHS.customCacheDir.replace(/\\/g, '\\\\')}"`,
        'registry "https://registry.yarnpkg.com"',
      ].join('\n'),
    });

    const config = await readYarnGlobalConfig(deps);
    expect(config).toMatchObject({
      prefixDir: YARN_DEPS_PATHS.customPrefix,
      binDir: `${YARN_DEPS_PATHS.customPrefix}\\bin`,
      globalDir: YARN_DEPS_PATHS.customGlobalDir,
      cacheDir: YARN_DEPS_PATHS.customCacheDir,
      explicitPrefix: true,
      binOnPath: false,
      policy: {
        defaultRegistry: 'public',
        scopedRegistries: [],
        unknownRouting: false,
        publicAuthPresent: false,
        changeUnsupported: false,
      },
    });
    expect(
      config.configIdentities.some(
        (id) =>
          id.file.path.toLowerCase() ===
          `${YARN_DEPS_PATHS.profile}\\.yarnrc`.toLowerCase(),
      ),
    ).toBe(true);
  });

  it('supports PREFIX, YARN_GLOBAL_FOLDER and YARN_CACHE_FOLDER env overrides', async () => {
    const { deps } = buildDeps({
      PREFIX: YARN_DEPS_PATHS.customPrefix,
      YARN_GLOBAL_FOLDER: YARN_DEPS_PATHS.customGlobalDir,
      YARN_CACHE_FOLDER: YARN_DEPS_PATHS.customCacheDir,
      PATH: `${YARN_DEPS_PATHS.customPrefix}\\bin`,
    });
    const config = await readYarnGlobalConfig(deps);
    expect(config.prefixDir).toBe(YARN_DEPS_PATHS.customPrefix);
    expect(config.binDir).toBe(`${YARN_DEPS_PATHS.customPrefix}\\bin`);
    expect(config.globalDir).toBe(YARN_DEPS_PATHS.customGlobalDir);
    expect(config.cacheDir).toBe(YARN_DEPS_PATHS.customCacheDir);
    expect(config.explicitPrefix).toBe(true);
    expect(config.binOnPath).toBe(true);
  });

  it('marks changeUnsupported when .yarnrc declares yarn-path or .npmrc declares onload-script', async () => {
    const { put, deps } = buildDeps();
    put(`${YARN_DEPS_PATHS.profile}\\.yarnrc`, {
      text: 'yarn-path "C:\\\\evil.js"\n',
    });
    const c1 = await readYarnGlobalConfig(deps);
    expect(c1.policy.changeUnsupported).toBe(true);

    const b2 = buildDeps();
    b2.put(`${YARN_DEPS_PATHS.profile}\\.npmrc`, {
      text: 'onload-script=C:\\evil.js\n',
    });
    const c2 = await readYarnGlobalConfig(b2.deps);
    expect(c2.policy.changeUnsupported).toBe(true);
  });

  it('records custom/scoped registries and public auth presence without storing credentials', async () => {
    const { put, deps } = buildDeps();
    put(`${YARN_DEPS_PATHS.profile}\\.yarnrc`, {
      text: [
        'registry "https://private.example.invalid/npm"',
        '"@corp:registry" "https://corp.example.invalid/npm"',
      ].join('\n'),
    });
    put(`${YARN_DEPS_PATHS.profile}\\.npmrc`, {
      text: '//registry.npmjs.org/:_authToken=secret-token-value\n',
    });
    const config = await readYarnGlobalConfig(deps);
    expect(config.policy.defaultRegistry).toBe('custom');
    expect(config.policy.scopedRegistries).toEqual(['@corp']);
    expect(config.policy.publicAuthPresent).toBe(true);
    expect(JSON.stringify(config)).not.toContain('secret-token-value');
  });

  it('refuses symlinked rc file, malformed .yarnrc syntax, overlapping layout, or cross-drive folders', async () => {
    const symlinkCase = buildDeps();
    symlinkCase.put(`${YARN_DEPS_PATHS.profile}\\.yarnrc`, {
      link: true,
      real: 'D:\\TEST\\other\\.yarnrc',
      text: '',
    });
    await expectGlobalReason(
      () => readYarnGlobalConfig(symlinkCase.deps),
      'CONFIG_UNSUPPORTED',
    );

    const malformedCase = buildDeps();
    malformedCase.put(`${YARN_DEPS_PATHS.profile}\\.yarnrc`, {
      text: 'prefix "unclosed\n',
    });
    await expectGlobalReason(
      () => readYarnGlobalConfig(malformedCase.deps),
      'CONFIG_UNSUPPORTED',
    );

    const overlapCase = buildDeps({
      PREFIX: YARN_DEPS_PATHS.customPrefix,
      YARN_GLOBAL_FOLDER: `${YARN_DEPS_PATHS.customPrefix}\\bin`,
    });
    await expectGlobalReason(
      () => readYarnGlobalConfig(overlapCase.deps),
      'LOCATION_AMBIGUOUS',
    );

    const crossDriveCase = buildDeps({
      PREFIX: 'C:\\YarnPrefix',
      YARN_GLOBAL_FOLDER: 'D:\\YarnGlobal',
    });
    await expectGlobalReason(
      () => readYarnGlobalConfig(crossDriveCase.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  it('allows shared pnpm path keys in .npmrc and refuses YARN_CONFIG or .yarnrc.yml', async () => {
    const sharedNpmrc = buildDeps({
      npm_config_userconfig: 'D:\\TEST\\profile\\.npmrc',
      npm_config_globalconfig: 'D:\\TEST\\npm-prefix\\etc\\npmrc',
      npm_config_cache: 'D:\\TEST\\npm-cache',
    });
    sharedNpmrc.put(`${YARN_DEPS_PATHS.profile}\\.npmrc`, {
      text: [
        'store-dir=D:\\TEST\\pnpm-store',
        'global-dir=D:\\TEST\\pnpm-global',
        'global-bin-dir=D:\\TEST\\pnpm-bin',
      ].join('\n'),
    });
    const config = await readYarnGlobalConfig(sharedNpmrc.deps);
    expect(config.globalDir).toBe(YARN_DEPS_PATHS.defaultGlobalDir);

    const yarnConfigEnv = buildDeps({
      YARN_CONFIG: 'D:\\TEST\\profile\\custom.yarnrc',
    });
    await expectGlobalReason(
      () => readYarnGlobalConfig(yarnConfigEnv.deps),
      'CONFIG_UNSUPPORTED',
    );

    const ymlRc = buildDeps();
    ymlRc.put(`${YARN_DEPS_PATHS.profile}\\.yarnrc.yml`, {
      text: 'nodeLinker: node-modules\n',
    });
    await expectGlobalReason(
      () => readYarnGlobalConfig(ymlRc.deps),
      'CONFIG_UNSUPPORTED',
    );
  });
});
