import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { createHash } from 'node:crypto';
import {
  assessPnpmGlobalRegistryPolicy,
  readPnpmGlobalConfig,
} from '@/global-packages/config/pnpm-global-config';
import type {
  IPnpmGlobalConfigDeps,
  IPnpmGlobalPolicy,
} from '@/global-packages/interfaces/pnpm-global.types';
import type { IGlobalRegistryInput } from '@/global-packages/interfaces/global-packages.runtime';
import {
  expectGlobalReason,
  memoryFs,
  TEST_PATHS as P,
  testTool,
} from '@/global-packages/__fixtures__/global-adapters';
import { PNPM_TEST_PATHS as Q } from '@/global-packages/__fixtures__/pnpm11/facts';
import {
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
} from '@/global-packages/config/global-config';

// TEST không phải yêu cầu nghiệp vụ. Read fixed inert fixtures, mock every host path.
const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', '__fixtures__', 'pnpm11', name), 'utf8');

function setup(
  patch: NodeJS.ProcessEnv = {},
  yaml: string | null = fixture('config.yaml'),
) {
  const memory = memoryFs();
  const environment: NodeJS.ProcessEnv = {
    USERPROFILE: Q.profile,
    HOME: Q.profile,
    LOCALAPPDATA: Q.local,
    PNPM_HOME: Q.home,
    XDG_CONFIG_HOME: 'D:\\TEST\\xdg',
    PATH: `${Q.bin};C:\\Program Files\\nodejs`,
    ...patch,
  };
  const checkDirectory = jest
    .fn<Promise<void>, [string]>()
    .mockResolvedValue(undefined);
  const controller = new AbortController();
  const deps: IPnpmGlobalConfigDeps = {
    fs: memory.fs,
    environment,
    signal: controller.signal,
    tool: testTool('pnpm'),
    cwd: P.cwd,
    checkDirectory,
  };
  for (const path of [Q.home, Q.bin, P.cwd])
    memory.put(path, { directory: true });
  if (yaml !== null) memory.put(Q.yaml, { text: yaml });
  memory.put(Q.auth, { text: fixture('public-auth.npmrc') });
  return { ...memory, deps, environment, checkDirectory, controller };
}

describe('pnpm 11 static config and source facts', () => {
  it.each(['lower', 'upper'])(
    'reads config under npm run environment (%s case), retaining the auth selector',
    async (casing) => {
      const authFile = 'D:\\TEST\\npm-run.npmrc';
      const injected = {
        npm_config_prefix: 'D:\\TEST\\npm',
        npm_config_globalconfig: 'D:\\TEST\\npm\\etc\\npmrc',
        npm_config_userconfig: authFile,
        npm_config_cache: 'D:\\TEST\\npm-cache',
        npm_config_user_agent: 'npm/11.13.0 node/v24.16.0 win32 x64',
        npm_config_node_gyp: 'D:\\TEST\\npm\\node-gyp.js',
        npm_config_local_prefix: 'D:\\TEST\\api',
        npm_config_global_prefix: 'D:\\TEST\\npm',
        npm_config_init_module: 'D:\\TEST\\profile\\.npm-init.js',
        npm_config_npm_version: '11.13.0',
        npm_config_noproxy: '',
      };
      const environment = Object.fromEntries(
        Object.entries(injected).map(([key, value]) => [
          casing === 'upper' ? key.toUpperCase() : key,
          value,
        ]),
      );
      const h = setup(environment, `globalBinDir: '${Q.bin}'`);
      h.put(authFile, {
        text: '//registry.npmjs.org/:_authToken=TEST-not-a-token',
      });
      const config = await readPnpmGlobalConfig(h.deps);
      expect(config.authFile).toBe(authFile);
      expect(config.policy).toMatchObject({
        publicAuthPresent: true,
        unknownRouting: false,
        changeUnsupported: false,
      });
      expect(JSON.stringify(config)).not.toContain('TEST-not-a-token');
    },
  );

  it('reads config under pnpm run environment without mistaking obsolete PM settings for hooks', async () => {
    // pnpm 11.22.0:168216,169205-169206 consumes verify-deps-before-run;
    // 168175,168966-168967 consumes pm-on-fail. These values enable neither
    // auto-install-before-run nor PM download. The schema gate ignores the
    // removed manage-package-manager-versions key (166500-166503).
    const h = setup({
      npm_config_user_agent: 'pnpm/11.22.0 npm/? node/v24.16.0 win32 x64',
      pnpm_config_verify_deps_before_run: 'false',
      pnpm_config_pm_on_fail: 'ignore',
      pnpm_config_manage_package_manager_versions: 'false',
    });
    expect((await readPnpmGlobalConfig(h.deps)).policy).toMatchObject({
      unknownRouting: false,
      changeUnsupported: false,
    });
  });

  it.each(['false', 'true'])(
    'ignores schema-less PM management env (%s), while refusing the same key in YAML/INI',
    async (value) => {
      const h = setup({ PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: value });
      expect(
        (await readPnpmGlobalConfig(h.deps)).policy.changeUnsupported,
      ).toBe(false);
      for (const [file, text] of [
        [
          Q.yaml,
          `${fixture('config.yaml')}\nmanagePackageManagerVersions: ${value}`,
        ],
        [Q.auth, `manage-package-manager-versions=${value}`],
      ]) {
        const source = setup();
        source.put(file, { text });
        await expectGlobalReason(
          () => readPnpmGlobalConfig(source.deps),
          'CONFIG_UNSUPPORTED',
        );
      }
    },
  );

  it.each(['workspace', 'config', 'environment'] as const)(
    'refuses lockfileDir hook-root redirection from %s before either mutation',
    async (source) => {
      // pnpm 11.22.0:168774-168785,321912-321923,322424: workspace
      // lockfileDir becomes the default hook root before add/remove dispatch.
      const h = setup(
        source === 'environment'
          ? {
              pnpm_config_lockfile_dir: 'E:\\TEST\\foreign',
            }
          : {},
      );
      if (source !== 'environment')
        h.put(
          source === 'workspace'
            ? win32.join(Q.root, 'pnpm-workspace.yaml')
            : Q.yaml,
          {
            text:
              source === 'workspace'
                ? "lockfileDir: 'E:\\TEST\\foreign'"
                : `${fixture('config.yaml')}\nlockfileDir: 'E:\\TEST\\foreign'`,
          },
        );
      await expectGlobalReason(
        () => readPnpmGlobalConfig(h.deps),
        'CONFIG_UNSUPPORTED',
      );
      expect(
        h.open.mock.calls.some(([path]) => path.startsWith('E:\\TEST')),
      ).toBe(false);
    },
  );

  it.each([
    'pnpmfile[]=E:\\TEST\\hook.cjs',
    'global-pnpmfile[]=E:\\TEST\\hook.cjs',
    'lockfile-dir[]=E:\\TEST\\foreign',
    '"pnpmfile"=E:\\TEST\\hook.cjs',
    "'global-pnpmfile'=E:\\TEST\\hook.cjs",
    '"pnpm\\u0066ile"=E:\\TEST\\hook.cjs',
    '\'"pnpm\\u0066ile"\'=E:\\TEST\\hook.cjs',
    'pnpmfile # ignored suffix=E:\\TEST\\hook.cjs',
    '[lockfile-dir]\npath=E:\\TEST\\foreign',
  ])(
    'refuses INI selector spelling before pnpm can decode it: %s',
    async (text) => {
      const h = setup();
      h.put(Q.auth, { text });
      await expectGlobalReason(
        () => readPnpmGlobalConfig(h.deps),
        'CONFIG_UNSUPPORTED',
      );
    },
  );

  const unprovenSelectors = [
    // Hook consumers:321888-321923; key transfer:169192-169203.
    'pnpmfile',
    'globalPnpmfile',
    'ignorePnpmfile',
    'hooks',
    'configDependencies',
    'tokenHelper',
    'include',
    'includes',
    'plugins',
    'finders',
    // Paths/layout:168098-168226,168887-168895; context:169287-169342.
    'lockfileDir',
    'modulesDir',
    'virtualStoreDir',
    'globalVirtualStoreDir',
    'virtualStoreDirMaxLength',
    'enableGlobalVirtualStore',
    'nodeLinker',
    'onlyBuiltDependenciesFile',
    'patchesDir',
    'patchedDependencies',
    'packDestination',
    'dir',
    'bin',
    'globalPkgDir',
    'rootProjectManifestDir',
    'workspaceDir',
    'workspaceRoot',
    'workspacePackages',
    'workspacePackagePatterns',
    'packages',
    'extraBinPaths',
    'extraNodePaths',
    'extraEnv',
    'globalPath',
    'npmPath',
    'extendNodePath',
    'preferSymlinkedExecutables',
    'nodeExperimentalPackageMap',
    'nodePackageMapType',
    'scriptShell',
    'shellEmulator',
    'shell',
    'shellArgs',
    'nodeOptions',
    'nodeExecPath',
    'nodeVersion',
    'useNodeVersion',
    'executionEnv',
    'runtime',
    'runtimeOnFail',
    'managePackageManagerVersions',
    // These maps may carry file:/link:/workspace: replacements (167031-167061).
    'overrides',
    'packageExtensions',
    'catalog',
    'catalogs',
    'pnprServer',
    // Unknown future selector shapes are never evidence of inertness.
    'futureDir',
    'futureHook',
    'futurePlugin',
  ] as const;
  it('does not mistake scoped registry/auth URLs containing workspace or plugin for selectors', async () => {
    const h = setup();
    h.put(Q.auth, {
      text: '@workspace:registry=https://private.invalid/\n//private.invalid/plugins/:_authToken=TEST-not-a-token',
    });
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config.policy.scopedRegistries).toContain('@workspace');
    expect(config.policy.changeUnsupported).toBe(false);
    expect(JSON.stringify(config)).not.toContain('TEST-not-a-token');
  });
  it.each(['workspace', 'config', 'environment'] as const)(
    'refuses unproven executable/layout selectors from %s for change and remove',
    async (source) => {
      for (const key of unprovenSelectors) {
        // pnpm 11.22.0:166500-166503: obsolete PM management has no env schema.
        if (source === 'environment' && key === 'managePackageManagerVersions')
          continue;
        const envKey = `pnpm_config_${key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)}`;
        const h = setup(
          source === 'environment' ? { [envKey]: 'D:\\TEST\\foreign' } : {},
        );
        if (source !== 'environment')
          h.put(
            source === 'workspace'
              ? win32.join(Q.root, 'pnpm-workspace.yaml')
              : Q.yaml,
            {
              text: `${source === 'config' ? fixture('config.yaml') : ''}\n${key}: 'D:\\TEST\\foreign'`,
            },
          );
        await expectGlobalReason(
          () => readPnpmGlobalConfig(h.deps),
          'CONFIG_UNSUPPORTED',
        );
      }
    },
  );

  it('pins consumed YAML safety when env deny is ignored and group allows a build (review F4)', async () => {
    // pnpm-11.22.0.mjs:166500-166503,168242-168245: no allow-builds env schema.
    // 168774-168785: global group YAML replaces global YAML settings.
    const h = setup(
      {
        pnpm_config_allow_builds: '{"test-native":false}',
        pnpm_config_minimum_release_age: '0',
      },
      `globalBinDir: '${Q.bin}'\nminimumReleaseAge: 2880\nallowBuilds: {test-native: false}`,
    );
    h.put(win32.join(Q.home, 'global', 'v11', 'pnpm-workspace.yaml'), {
      text: 'minimumReleaseAge: 4320\nallowBuilds: {test-native: true}',
    });
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config.safety).toMatchObject({
      minimumReleaseAge: 4320,
      minimumReleaseAgeStrict: true,
      allowBuilds: { 'test-native': true },
    });
    expect(config.policy.changeUnsupported).toBe(true);
    expect(
      assessPnpmGlobalRegistryPolicy(
        policyInput({ pnpmPolicies: [config.policy] }),
      ).changeAllowed,
    ).toBe(false);
  });

  it('pins consumed default safety when both YAML sources omit it (review F4)', async () => {
    // pnpm-11.22.0.mjs:168516-168517,168867-168868: one day; global GVS default build deny map.
    const h = setup({}, `globalBinDir: '${Q.bin}'`);
    expect((await readPnpmGlobalConfig(h.deps)).safety).toMatchObject({
      minimumReleaseAge: 1440,
      allowBuilds: {},
    });
  });

  it.each([
    'allow-builds',
    'minimum-release-age',
    'minimum_release_age_strict',
  ])(
    'refuses to claim a noncanonical YAML safety policy from %s (review F4)',
    async (key) => {
      const h = setup(
        {},
        `globalBinDir: '${Q.bin}'\n${key}: ${key === 'allow-builds' ? '{test-native: false}' : '0'}`,
      );
      const config = await readPnpmGlobalConfig(h.deps);
      expect(config.policy.changeUnsupported).toBe(true);
      expect(config.safety).toMatchObject({
        minimumReleaseAge: 1440,
        allowBuilds: {},
      });
    },
  );
  it('refuses unmodeled release-age controls rather than claiming resolved policy (review F4)', async () => {
    const h = setup(
      {},
      `globalBinDir: '${Q.bin}'\nminimumReleaseAgeExclude: [test-native]`,
    );
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config.policy.changeUnsupported).toBe(true);
  });
  it.each([
    'global-bin-dir',
    'global_bin_dir',
    'GlobalBinDir',
    'global-dir',
    'store-dir',
    'cache-dir',
    'state-dir',
    'npmrc-auth-file',
  ])(
    'refuses noncanonical YAML %s with both actual and requested bins on PATH (review F1)',
    async (key) => {
      // pnpm-11.22.0.mjs:168608-168628: only camelCase YAML survives filtering.
      const h = setup(
        { PATH: `${Q.home}\\bin;D:\\TEST\\other-bin` },
        `${key}: 'D:\\TEST\\other-bin'`,
      );
      h.put(`${Q.home}\\bin`, { directory: true });
      h.put('D:\\TEST\\other-bin', { directory: true });
      await expectGlobalReason(
        () => readPnpmGlobalConfig(h.deps),
        'CONFIG_UNSUPPORTED',
      );
    },
  );
  it('derives H/G/R/B/S independently and preserves the configured v11 suffix', async () => {
    const h = setup();
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config).toMatchObject({
      homeDir: Q.home,
      globalDir: Q.global,
      globalRoot: Q.root,
      binDir: Q.bin,
      storeDir: Q.store,
      cacheDir: Q.cache,
      stateDir: Q.state,
      configDir: Q.config,
      authFile: Q.auth,
      originalPath: [Q.bin, 'C:\\Program Files\\nodejs'],
      safety: {
        minimumReleaseAge: 1440,
        minimumReleaseAgeStrict: true,
        allowBuilds: { 'test-native': false },
      },
    });
    expect(config.policy.publicAuthPresent).toBe(true);
    expect(JSON.stringify(config)).not.toContain('TEST-not-a-token');
    expect(h.readFile).not.toHaveBeenCalled();
  });

  it.each([
    [{ PNPM_HOME: Q.home, XDG_DATA_HOME: 'D:\\TEST\\data' }, Q.home],
    [
      { PNPM_HOME: undefined, XDG_DATA_HOME: 'D:\\TEST\\data' },
      'D:\\TEST\\data\\pnpm',
    ],
    [
      { PNPM_HOME: undefined, XDG_DATA_HOME: undefined },
      'D:\\TEST\\local\\pnpm',
    ],
    [
      {
        PNPM_HOME: undefined,
        XDG_DATA_HOME: undefined,
        LOCALAPPDATA: undefined,
      },
      'D:\\TEST\\profile\\.pnpm',
    ],
  ] satisfies [NodeJS.ProcessEnv, string][])(
    'uses home precedence for %p',
    async (environment, home) => {
      const bin = win32.join(home, 'bin');
      const h = setup({ ...environment, PATH: bin }, null);
      h.put(bin, { directory: true });
      expect(await readPnpmGlobalConfig(h.deps)).toMatchObject({
        homeDir: home,
        globalDir: win32.join(home, 'global'),
        globalRoot: win32.join(home, 'global', 'v11'),
        binDir: bin,
        storeDir: null,
      });
    },
  );

  it.each([
    [{}, Q.config],
    [{ XDG_CONFIG_HOME: undefined }, 'D:\\TEST\\local\\pnpm\\config'],
    [
      { XDG_CONFIG_HOME: undefined, LOCALAPPDATA: undefined },
      'D:\\TEST\\profile\\.config\\pnpm',
    ],
  ] satisfies [NodeJS.ProcessEnv, string][])(
    'pins config-directory precedence and absence for %p',
    async (environment, configDir) => {
      const h = setup(environment, null);
      h.put(win32.join(Q.home, 'bin'), { directory: true });
      h.environment.PATH = win32.join(Q.home, 'bin');
      const result = await readPnpmGlobalConfig(h.deps);
      expect(result.configDir).toBe(configDir);
      expect(result.missingConfigPaths).toContain(
        win32.join(configDir, 'config.yaml'),
      );
    },
  );

  it('pins XDG cache/state paths separately from PNPM_HOME', async () => {
    const h = setup(
      { XDG_CACHE_HOME: 'D:\\TEST\\cache', XDG_STATE_HOME: 'D:\\TEST\\state' },
      null,
    );
    h.put(win32.join(Q.home, 'bin'), { directory: true });
    h.environment.PATH = win32.join(Q.home, 'bin');
    expect(await readPnpmGlobalConfig(h.deps)).toMatchObject({
      cacheDir: 'D:\\TEST\\cache\\pnpm',
      stateDir: 'D:\\TEST\\state\\pnpm',
    });
  });

  it('refuses env safety overrides rather than claiming they replace consumed YAML', async () => {
    const h = setup(
      {
        pnpm_config_minimum_release_age: '2880',
        pnpm_config_minimum_release_age_strict: 'true',
        pnpm_config_allow_builds: '{"test-native":false}',
      },
      `globalBinDir: '${Q.bin}'`,
    );
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config.safety).toEqual({
      minimumReleaseAge: 1440,
      allowBuilds: {},
    });
    expect(config.policy.changeUnsupported).toBe(true);
  });

  it.each(['D:\\TEST\\store', 'D:\\TEST\\store\\v11'])(
    'normalizes versioned store once for %s',
    async (store) => {
      const h = setup({}, `globalBinDir: '${Q.bin}'\nstoreDir: '${store}'`);
      expect((await readPnpmGlobalConfig(h.deps)).storeDir).toBe(
        'D:\\TEST\\store\\v11',
      );
    },
  );

  it.each([
    ['D:\\TEST\\store\\V11', 'D:\\TEST\\store\\V11\\v11'],
    ['D:\\TEST\\store\\v11\\', 'D:\\TEST\\store\\v11\\v11'],
    ['D:/TEST/store/v11', 'D:\\TEST\\store\\v11\\v11'],
  ])(
    'pins the exact pnpm store suffix for %s (review F2)',
    async (store, expected) => {
      // pnpm-11.22.0.mjs:166015-166016,182655-182659: absolute paths keep trailing separators.
      const h = setup({}, `globalBinDir: '${Q.bin}'\nstoreDir: '${store}'`);
      expect((await readPnpmGlobalConfig(h.deps)).storeDir).toBe(expected);
    },
  );

  it.each([
    [
      {
        pnpm_config_npmrc_auth_file: 'D:\\TEST\\first.npmrc',
        pnpm_config_userconfig: 'D:\\TEST\\second.npmrc',
        npm_config_userconfig: 'D:\\TEST\\third.npmrc',
      },
      'D:\\TEST\\first.npmrc',
    ],
    [
      {
        pnpm_config_userconfig: 'D:\\TEST\\second.npmrc',
        npm_config_userconfig: 'D:\\TEST\\third.npmrc',
      },
      'D:\\TEST\\second.npmrc',
    ],
    [{ npm_config_userconfig: 'D:\\TEST\\third.npmrc' }, Q.auth],
  ] satisfies [NodeJS.ProcessEnv, string][])(
    'resolves auth-file precedence without retaining credentials: %p',
    async (environment, authFile) => {
      const h = setup(environment);
      h.put(authFile, { text: fixture('public-auth.npmrc') });
      expect((await readPnpmGlobalConfig(h.deps)).authFile).toBe(authFile);
    },
  );

  it.each([
    [
      { npm_config_userconfig: 'D:\\TEST\\third.npmrc' },
      'D:\\TEST\\third.npmrc',
    ],
    [{}, 'D:\\TEST\\profile\\.npmrc'],
  ] satisfies [NodeJS.ProcessEnv, string][])(
    'uses npm env then profile auth when YAML has no selector: %p',
    async (environment, authFile) => {
      const h = setup(environment, `globalBinDir: '${Q.bin}'`);
      expect((await readPnpmGlobalConfig(h.deps)).authFile).toBe(authFile);
    },
  );

  it.each([
    [Q.yaml, fixture('config.yaml')],
    [Q.auth, fixture('public-auth.npmrc')],
    [win32.join(Q.config, 'auth.ini'), fixture('auth.ini')],
    [
      win32.join(P.cwd, '.npmrc'),
      '# TEST\nregistry=https://registry.npmjs.org/',
    ],
    [
      win32.join(P.pnpm, 'dist', 'pnpmrc'),
      '# TEST\nregistry=https://registry.npmjs.org/',
    ],
    [
      win32.join(Q.root, 'pnpm-workspace.yaml'),
      '# TEST\nminimumReleaseAge: 1440',
    ],
  ])('pins source identity and SHA256 for %s', async (path, text) => {
    const h = setup();
    h.put(path, { text });
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config.configIdentities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.objectContaining({ path }) as unknown,
          sha256: createHash('sha256').update(text).digest('hex'),
        }),
      ]),
    );
    expect(config.missingConfigPaths).not.toContain(path);
    expect(JSON.stringify(config)).not.toContain('TEST-not-a-token');
  });

  it('captures absent sources, including an absent global root, without creating them', async () => {
    const h = setup();
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config.missingConfigPaths).toEqual(
      expect.arrayContaining([
        win32.join(Q.config, 'auth.ini'),
        win32.join(P.cwd, '.npmrc'),
        win32.join(P.pnpm, 'dist', 'pnpmrc'),
        win32.join(Q.root, 'pnpm-workspace.yaml'),
      ]),
    );
    expect(h.entries.has(Q.root.toLowerCase())).toBe(false);
    expect(config.missingDirectoryPaths).toContain(Q.root);
    expect(config.directoryIdentities).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: Q.bin })]),
    );
  });

  it.each(['', '.;relative', 'D:\\TEST\\elsewhere', `${Q.bin}-sibling`])(
    'refuses a bin missing from the original absolute PATH: %s',
    async (PATH) => {
      const h = setup({ PATH });
      await expectGlobalReason(
        () => readPnpmGlobalConfig(h.deps),
        'PNPM_GLOBAL_NOT_CONFIGURED',
      );
    },
  );

  it('accepts PATH casing/trailing separator without adding a PATH entry', async () => {
    const h = setup({
      Path: `.;relative;${Q.bin.toUpperCase()}\\;C:\\Windows`,
      PATH: undefined,
    });
    expect((await readPnpmGlobalConfig(h.deps)).originalPath).toEqual([
      `${Q.bin.toUpperCase()}\\`,
      'C:\\Windows',
    ]);
  });

  it('reports not configured when B is absent even if PATH contains it', async () => {
    const h = setup();
    h.entries.delete(Q.bin.toLowerCase());
    await expectGlobalReason(
      () => readPnpmGlobalConfig(h.deps),
      'PNPM_GLOBAL_NOT_CONFIGURED',
    );
  });

  it.each([
    { PNPM_HOME: 'relative' },
    { PNPM_HOME: '\\\\server\\share' },
    { XDG_CONFIG_HOME: '${HOME}\\config' },
    { pnpm_config_npmrc_auth_file: 'D:relative' },
    { pnpm_config_global_dir: 'D:\\TEST\\wrong' },
    { pnpm_config_global_bin_dir: 'D:\\TEST\\wrong' },
    { pnpm_config_config_dir: 'D:\\TEST\\wrong' },
    { pnpm_config_pnpm_home_dir: 'D:\\TEST\\wrong' },
    { PNPM_HOME: Q.home, pnpm_home: 'D:\\TEST\\other' },
  ] satisfies NodeJS.ProcessEnv[])(
    'refuses ambiguous selectors before a child can reinterpret them: %p',
    async (environment) => {
      const h = setup(environment);
      await expectGlobalReason(
        () => readPnpmGlobalConfig(h.deps),
        'CONFIG_UNSUPPORTED',
      );
    },
  );

  it.each([
    'globalDir: one\nglobalDir: two',
    'globalDir: &root D:\\TEST\\global\nglobalBinDir: *root',
    'globalDir: !custom D:\\TEST\\global',
    '<<: {globalDir: D:\\TEST\\global}',
    '__proto__: {polluted: true}',
    'constructor: {prototype: {polluted: true}}',
    'globalDir: ../global',
    'globalBinDir: [D:\\TEST\\bin]',
    'storeDir: "${HOME}/store"',
    'registry: [',
    `x: ${'['.repeat(65)}0${']'.repeat(65)}`,
  ])('rejects unsafe YAML without exposing source bytes: %s', async (yaml) => {
    const h = setup({}, yaml);
    await expectGlobalReason(
      () => readPnpmGlobalConfig(h.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  it.each([Q.yaml, Q.auth])(
    'refuses redirected configuration %s',
    async (path) => {
      const h = setup();
      h.put(path, {
        link: true,
        real: 'D:\\TEST\\outside',
        text: 'TEST-not-a-token',
      });
      await expectGlobalReason(
        () => readPnpmGlobalConfig(h.deps),
        'CONFIG_UNSUPPORTED',
      );
    },
  );

  it('applies the injected directory guard without swallowing its reason', async () => {
    const h = setup();
    h.checkDirectory.mockRejectedValue(
      new Error('TEST directory guard refused'),
    );
    await expect(readPnpmGlobalConfig(h.deps)).rejects.toThrow(
      'TEST directory guard refused',
    );
  });

  it('honors cancellation without reading configuration', async () => {
    const h = setup();
    h.controller.abort(new Error('TEST cancelled'));
    await expect(readPnpmGlobalConfig(h.deps)).rejects.toThrow(
      'TEST cancelled',
    );
    expect(h.open).not.toHaveBeenCalled();
  });

  it('bounds each opened source to 1 MiB', async () => {
    const h = setup({}, `#${'x'.repeat(GLOBAL_CONFIG_FILE_LIMIT)}`);
    await expectGlobalReason(
      () => readPnpmGlobalConfig(h.deps),
      'LIMIT_EXCEEDED',
    );
  });

  it('closes opened handles, including a cancelled read', async () => {
    const h = setup();
    const originalOpen = h.open.getMockImplementation();
    if (!originalOpen) throw new Error('TEST missing memory opener');
    const close = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    h.open.mockImplementation(async (path) => {
      const handle = await originalOpen(path);
      return {
        stat: () => handle.stat(),
        async *readChunks() {
          await Promise.resolve();
          h.controller.abort(new Error('TEST cancelled during read'));
          yield Buffer.from('TEST');
        },
        close,
      };
    });
    await expect(readPnpmGlobalConfig(h.deps)).rejects.toThrow(
      'TEST cancelled during read',
    );
    expect(close).toHaveBeenCalled();
  });

  it('bounds bytes from the open handle even when lstat underreports size', async () => {
    const h = setup();
    const originalOpen = h.open.getMockImplementation();
    if (!originalOpen) throw new Error('TEST missing memory opener');
    h.open.mockImplementation(async (path) => {
      const handle = await originalOpen(path);
      return {
        stat: () => handle.stat(),
        async *readChunks() {
          await Promise.resolve();
          yield Buffer.alloc(GLOBAL_CONFIG_FILE_LIMIT + 1, 32);
        },
        close: () => handle.close(),
      };
    });
    await expectGlobalReason(
      () => readPnpmGlobalConfig(h.deps),
      'LIMIT_EXCEEDED',
    );
  });

  it('collects custom routing from auth.ini into a secret-free policy', async () => {
    const h = setup();
    h.put(win32.join(Q.config, 'auth.ini'), {
      text: 'registry=https://private.invalid\n//private.invalid/:_authToken=TEST-not-a-token',
    });
    const config = await readPnpmGlobalConfig(h.deps);
    expect(
      assessPnpmGlobalRegistryPolicy(
        policyInput({
          pnpmPolicies: [config.policy],
        }),
      ),
    ).toMatchObject({
      changeAllowed: false,
      reason: 'REGISTRY_CONFIG_UNSUPPORTED',
    });
    expect(JSON.stringify(config)).not.toContain('TEST-not-a-token');
  });

  it('bounds combined sources and environment to 8 MiB, including auth bytes', async () => {
    const h = setup({
      pnpm_config__auth: 'x'.repeat(GLOBAL_CONFIG_TOTAL_LIMIT),
    });
    await expectGlobalReason(
      () => readPnpmGlobalConfig(h.deps),
      'LIMIT_EXCEEDED',
    );
  });

  it('keeps path selectors and summaries without raw auth/config/env snapshots', async () => {
    const h = setup({
      NPM_TOKEN: 'TEST-not-a-token',
      npm_config_force: 'true',
    });
    const before = JSON.stringify(h.environment);
    Object.freeze(h.environment);
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config.selectors).toMatchObject({ PNPM_HOME: Q.home });
    expect(JSON.stringify(config)).not.toMatch(
      /TEST-not-a-token|npm_config_force|_authToken/,
    );
    expect(JSON.stringify(h.environment)).toBe(before);
  });
});

const policyInput = (
  patch: Partial<IGlobalRegistryInput> = {},
): IGlobalRegistryInput => ({
  packageName: '@test/tool',
  action: 'change',
  configs: [],
  environment: {},
  provenanceKnown: true,
  ...patch,
});

describe('pnpm 11 registry policy unions YAML, INI and original environment', () => {
  it.each([
    'registries: {"@test": "https://private.invalid/"}',
    'registries: {default: "https://private.invalid/"}',
    'registries: {"@test": "https://registry.npmjs.org/"}',
    'registries: {"@other": "${TEST_REGISTRY}"}',
    'registries: {"${TEST_SCOPE}": "https://registry.npmjs.org/"}',
    'registries: {unknown: "https://private.invalid/"}',
    'registries: ["https://private.invalid/"]',
    'namedRegistries: {private: "https://private.invalid/"}',
    'namedRegistries: {private: "${TEST_REGISTRY}"}',
    'packageManagerRegistries: {default: "https://private.invalid/"}',
  ])(
    'refuses scoped/unknown/interpolated routing maps (review F3): %s',
    (text) => {
      // pnpm-11.22.0.mjs:167190-167203,168789-168811: YAML maps survive CLI default registry.
      expect(
        assessPnpmGlobalRegistryPolicy(policyInput({ configs: [text] })),
      ).toMatchObject({
        changeAllowed: false,
        reason: 'REGISTRY_CONFIG_UNSUPPORTED',
      });
      expect(
        assessPnpmGlobalRegistryPolicy(
          policyInput({ configs: [text], action: 'remove' }),
        ).reason,
      ).toBeNull();
    },
  );

  it('unions map routing across sources without blocking unrelated scopes (review F3)', () => {
    const unrelated = 'registries: {"@other": "https://private.invalid/"}';
    expect(
      assessPnpmGlobalRegistryPolicy(policyInput({ configs: [unrelated] }))
        .changeAllowed,
    ).toBe(true);
    expect(
      assessPnpmGlobalRegistryPolicy(
        policyInput({
          configs: [
            unrelated,
            'registries: {"@test": "https://private.invalid/"}',
            'registry: https://registry.npmjs.org/',
          ],
        }),
      ).changeAllowed,
    ).toBe(false);
  });

  it('retains scoped registry-map policy in static discovery (review F3)', async () => {
    const h = setup(
      {},
      `globalBinDir: '${Q.bin}'\nregistries: {"@test": "https://private.invalid/"}`,
    );
    const config = await readPnpmGlobalConfig(h.deps);
    expect(config.policy.scopedRegistries).toContain('@test');
    expect(
      assessPnpmGlobalRegistryPolicy(
        policyInput({ pnpmPolicies: [config.policy] }),
      ).changeAllowed,
    ).toBe(false);
  });
  it.each([
    '',
    fixture('public-auth.npmrc'),
    fixture('auth.ini'),
    'registry: https://registry.npmjs.org/',
    '_auth:\n  https://registry.npmjs.org/:\n    "@": {authToken: TEST-not-a-token}',
    '"@other:registry": https://private.invalid',
    '@other:registry=https://private.invalid',
    'fetchRetries: 2\ncolor: false',
  ])(
    'permits public auth or ordinary/unrelated config without copying values: %s',
    (text) => {
      const result = assessPnpmGlobalRegistryPolicy(
        policyInput({ configs: [text] }),
      );
      expect(result).toMatchObject({ changeAllowed: true, reason: null });
      expect(JSON.stringify(result)).not.toContain('TEST-not-a-token');
    },
  );

  it.each([
    'registry: https://private.invalid',
    'registry=https://private.invalid',
    '"@test:registry": https://registry.npmjs.org/',
    '@test:registry=https://private.invalid',
    '_auth:\n  https://private.invalid/:\n    "@": {authToken: TEST-not-a-token}',
    '_auth:\n  https://private.invalid/:\n    "@test": {authToken: TEST-not-a-token}',
    'registry: "${TEST_REGISTRY}"',
    'configDependencies: {test-plugin: 1.0.0}',
    'globalPnpmfile: D:\\TEST\\plugin.cjs',
    'pnpmfile=D:\\TEST\\plugin.cjs',
    'includes: [TEST.yaml]',
    'ignoreScripts: true',
    'dangerouslyAllowAllBuilds: true',
    'nodeLinker: hoisted',
    'minimumReleaseAge: nope',
    'minimumReleaseAgeStrict: "true"',
    'allowBuilds: {test-native: "yes"}',
  ])(
    'blocks versions/change for unsafe routing or unpinned safety: %s',
    (text) => {
      const result = assessPnpmGlobalRegistryPolicy(
        policyInput({ configs: [text] }),
      );
      expect(result).toMatchObject({
        changeAllowed: false,
        reason: 'REGISTRY_CONFIG_UNSUPPORTED',
      });
      expect(JSON.stringify(result)).not.toContain('TEST-not-a-token');
    },
  );

  it.each([
    { pnpm_config_registry: 'https://private.invalid' },
    { 'pnpm_config_@test:registry': 'https://private.invalid' },
    {
      pnpm_config__auth:
        '{"https://private.invalid/":{"@":{"authToken":"TEST-not-a-token"}}}',
    },
    {
      PNPM_CONFIG__AUTH:
        '{"https://private.invalid/":{"@test":{"authToken":"TEST-not-a-token"}}}',
    },
    { pnpm_config__auth: 'invalid TEST-not-a-token' },
    { pnpm_config_minimum_release_age: '-1' },
    { pnpm_config_minimum_release_age_strict: 'sometimes' },
    { pnpm_config_allow_builds: '{"test-native":"yes"}' },
  ] satisfies NodeJS.ProcessEnv[])(
    'inspects original environment routing before sanitization: %p',
    (environment) => {
      expect(
        assessPnpmGlobalRegistryPolicy(policyInput({ environment })),
      ).toMatchObject({
        changeAllowed: false,
        reason: 'REGISTRY_CONFIG_UNSUPPORTED',
      });
    },
  );

  it.each([
    { npm_config_registry: 'https://private.invalid/' },
    { NPM_CONFIG_REGISTRY: 'https://private.invalid/' },
    { 'npm_config_@test:registry': 'https://private.invalid/' },
    { npm_config__auth: 'not JSON, but ignored by pnpm' },
    { npm_config_pnpmfile: 'D:\\TEST\\hook.cjs' },
    { npm_config_ignore_scripts: 'true' },
  ])(
    'ignores non-URL npm env settings for pnpm routing: %p',
    async (environment) => {
      const config = await readPnpmGlobalConfig(setup(environment).deps);
      expect(config.policy).toMatchObject({
        defaultRegistry: 'public',
        unknownRouting: false,
        changeUnsupported: false,
      });
      expect(
        assessPnpmGlobalRegistryPolicy(policyInput({ environment })),
      ).toMatchObject({
        changeAllowed: true,
        reason: null,
        publicAuthPresent: false,
      });
    },
  );

  it.each([
    ['private.invalid', false],
    ['registry.npmjs.org', true],
  ] as const)(
    'retains URL-scoped npm env auth policy for %s without retaining credentials',
    async (host, publicAuthPresent) => {
      const environment = {
        [`npm_config_//${host}/:_authToken`]: 'TEST-not-a-token',
      };
      const h = setup(environment);
      h.put(Q.auth, { text: '' });
      const config = await readPnpmGlobalConfig(h.deps);
      expect(config.policy).toMatchObject({
        publicAuthPresent,
        unknownRouting: false,
        changeUnsupported: false,
      });
      const policy = assessPnpmGlobalRegistryPolicy(
        policyInput({ environment }),
      );
      expect(policy).toMatchObject({ changeAllowed: true, publicAuthPresent });
      expect(JSON.stringify({ config, policy })).not.toContain(
        'TEST-not-a-token',
      );
    },
  );

  it('still refuses URL-scoped npm env token helpers', async () => {
    const environment = {
      'npm_config_//private.invalid/:tokenHelper': 'D:\\TEST\\helper.cmd',
    };
    await expectGlobalReason(
      () => readPnpmGlobalConfig(setup(environment).deps),
      'CONFIG_UNSUPPORTED',
    );
    expect(
      assessPnpmGlobalRegistryPolicy(policyInput({ environment }))
        .changeAllowed,
    ).toBe(false);
  });

  it('does not let a later public source conceal earlier custom routing', () => {
    expect(
      assessPnpmGlobalRegistryPolicy(
        policyInput({
          configs: [
            'registry=https://private.invalid',
            'registry: https://registry.npmjs.org',
          ],
        }),
      ).changeAllowed,
    ).toBe(false);
  });

  it('permits unrelated auth scopes and typed safety settings', () => {
    expect(
      assessPnpmGlobalRegistryPolicy(
        policyInput({
          configs: [
            '_auth:\n  https://private.invalid/:\n    "@other": {authToken: TEST-not-a-token}',
            fixture('config.yaml'),
          ],
          environment: { npm_config_force: 'true', pnpm_config_color: 'false' },
        }),
      ),
    ).toMatchObject({ changeAllowed: true, reason: null });
  });

  it('reports public auth presence from JSON environment without returning credentials', () => {
    const result = assessPnpmGlobalRegistryPolicy(
      policyInput({
        environment: {
          pnpm_config__auth:
            '{"https://registry.npmjs.org/":{"@":{"authToken":"TEST-not-a-token"}}}',
        },
      }),
    );
    expect(result).toEqual({
      changeAllowed: true,
      reason: null,
      publicAuthPresent: true,
    });
  });

  it('accepts pre-parsed secret-free source policies from discovery', () => {
    const policy: IPnpmGlobalPolicy = {
      defaultRegistry: 'custom',
      scopedRegistries: [],
      unknownRouting: false,
      publicAuthPresent: true,
      changeUnsupported: false,
    };
    expect(
      assessPnpmGlobalRegistryPolicy(policyInput({ pnpmPolicies: [policy] })),
    ).toEqual({
      changeAllowed: false,
      reason: 'REGISTRY_CONFIG_UNSUPPORTED',
      publicAuthPresent: true,
    });
  });

  it.each([
    { configs: ['registry: https://private.invalid'] },
    { configs: ['"@test:registry": https://private.invalid'] },
    { provenanceKnown: false },
    { configs: ['ignoreScripts: true'] },
  ] satisfies Partial<IGlobalRegistryInput>[])(
    'permits offline removal with proven paths despite registry policy: %p',
    (patch) => {
      expect(
        assessPnpmGlobalRegistryPolicy(
          policyInput({ ...patch, action: 'remove' }),
        ).reason,
      ).toBeNull();
    },
  );

  it('refuses dynamic executable configuration even for removal', async () => {
    const h = setup(
      {},
      `globalBinDir: '${Q.bin}'\nglobalPnpmfile: D:\\TEST\\plugin.cjs`,
    );
    await expectGlobalReason(
      () => readPnpmGlobalConfig(h.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  it('refuses token helpers without exposing their values', async () => {
    const h = setup();
    h.put(Q.auth, {
      text: '//registry.npmjs.org/:tokenHelper=TEST-not-a-token',
    });
    await expectGlobalReason(
      () => readPnpmGlobalConfig(h.deps),
      'CONFIG_UNSUPPORTED',
    );
  });

  it('bounds direct policy input across all sources and environment', async () => {
    await expectGlobalReason(
      () =>
        assessPnpmGlobalRegistryPolicy(
          policyInput({
            environment: {
              pnpm_config__auth: 'x'.repeat(GLOBAL_CONFIG_TOTAL_LIMIT),
            },
            configs: ['registry=https://registry.npmjs.org/'],
          }),
        ),
      'LIMIT_EXCEEDED',
    );
  });
});
