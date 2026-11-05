import 'reflect-metadata';
import {
  buildGlobalCommand,
  buildGlobalQuery,
} from '@/global-packages/global-command';
import type {
  GlobalQuery,
  IGlobalMutationInput,
} from '@/global-packages/global-command';
import {
  expectGlobalReason,
  TEST_PATHS as P,
  testLocation,
  testTool,
} from '@/global-packages/__fixtures__/global-adapters';
import type { GlobalManager } from '@/global-packages/interfaces/global-packages.types';
import {
  PNPM_TEST_PATHS as Q,
  pnpmConfigFacts,
  pnpmLocation,
} from '@/global-packages/__fixtures__/pnpm11/facts';
import { consumePnpm11Environment } from '@/global-packages/__fixtures__/pnpm11/env-consumer';

const input = (
  manager: GlobalManager,
  patch: Partial<IGlobalMutationInput> = {},
): IGlobalMutationInput => ({
  location: manager === 'pnpm' ? pnpmLocation() : testLocation(manager),
  environment: manager === 'pnpm' ? { PATH: Q.bin } : {},
  action: 'change',
  packageName: '@test/tool',
  exactVersion: '2.0.0',
  publicRegistry: true,
  ...patch,
});
const common = (manager: GlobalManager): string[] =>
  manager === 'npm'
    ? [
        '--prefix',
        P.prefix,
        '--userconfig',
        P.userconfig,
        '--globalconfig',
        P.globalconfig,
        '--cache',
        P.cache,
        '--registry',
        'https://registry.npmjs.org',
        '--no-audit',
        '--no-fund',
        '--no-progress',
        '--update-notifier=false',
      ]
    : ['--dir', P.cwd, '--pm-on-fail=warn'];

describe('global command descriptors (argv require RT0)', () => {
  it.each(['npm', 'pnpm'] as const)(
    'pins the entire %s change vector',
    (manager) => {
      const tool = testTool(manager);
      const tail =
        manager === 'npm'
          ? ['install', '--global', '--', '@test/tool@2.0.0']
          : [
              'add',
              '--global',
              '--global-dir',
              Q.global,
              '--global-bin-dir',
              Q.bin,
              '--store-dir',
              Q.store,
              '--registry',
              'https://registry.npmjs.org',
              '--reporter=append-only',
              '--',
              '@test/tool@2.0.0',
            ];
      const command = buildGlobalCommand(input(manager));
      expect(command.file).toBe(P.node);
      expect(command.cwd).toBe(P.cwd);
      expect(command.args).toEqual([tool.entry, ...common(manager), ...tail]);
    },
  );
  it.each(['npm', 'pnpm'] as const)(
    'pins the entire %s remove vector',
    (manager) => {
      const tail =
        manager === 'npm'
          ? ['uninstall', '--global', '--', '@test/tool']
          : [
              'remove',
              '--global',
              '--global-dir',
              Q.global,
              '--store-dir',
              Q.store,
              '--reporter=append-only',
              '--',
              '@test/tool',
            ];
      expect(
        buildGlobalCommand(
          input(manager, {
            action: 'remove',
            exactVersion: null,
          }),
        ).args,
      ).toEqual([testTool(manager).entry, ...common(manager), ...tail]);
    },
  );
  it.each(['npm', 'pnpm'] as const)(
    'omits a forced public registry for %s custom-registry removal',
    (manager) => {
      const command = buildGlobalCommand(
        input(manager, {
          action: 'remove',
          exactVersion: null,
          publicRegistry: false,
        }),
      );
      expect(command.args).not.toContain('--registry');
      expect(command.args).not.toContain('https://registry.npmjs.org');
      expect(command.args.slice(-2)).toEqual(['--', '@test/tool']);
    },
  );
  it('refuses change without a proven public registry', async () => {
    await expectGlobalReason(
      () =>
        buildGlobalCommand(
          input('npm', {
            publicRegistry: false,
          }),
        ),
      'REGISTRY_CONFIG_UNSUPPORTED',
    );
  });
  it.each(['latest', '^2.0.0', 'v2.0.0', '2.0', '', '2.0.0\n', null])(
    'requires resolved canonical exact version %p',
    async (exactVersion) => {
      await expectGlobalReason(
        () =>
          buildGlobalCommand(
            input('npm', {
              exactVersion,
            }),
          ),
        'INVALID_PACKAGE_SPEC',
      );
    },
  );
  it.each([
    '--force',
    'tool@latest',
    'npm:tool',
    '../tool',
    'tool;whoami',
    'tool\n',
  ])('refuses arbitrary package input %s', async (packageName) => {
    await expectGlobalReason(
      () =>
        buildGlobalCommand(
          input('pnpm', {
            packageName,
          }),
        ),
      'INVALID_PACKAGE_SPEC',
    );
  });
  it('does not silently discard a remove target', async () => {
    await expectGlobalReason(
      () =>
        buildGlobalCommand(
          input('npm', {
            action: 'remove',
          }),
        ),
      'INVALID_PACKAGE_SPEC',
    );
  });
  it.each(['npm', 'pnpm'] as const)(
    'uses M6 environment rules and does not restore config or credentials for %s',
    (manager) => {
      const environment = Object.freeze({
        PATH: `.;relative;${manager === 'pnpm' ? Q.bin : 'D:\\TEST\\bin'}`,
        NODE_OPTIONS: '--require TEST.js',
        NODE_ENV: 'production',
        NPM_TOKEN: 'TEST-not-a-token',
        NODE_AUTH_TOKEN: 'TEST-not-a-token',
        npm_config_prefix: 'D:\\TEST\\wrong',
        npm_config_force: 'true',
        PNPM_CONFIG_GLOBAL_DIR: 'D:\\TEST\\wrong',
        pnpm_config_registry: 'https://private.invalid',
        CI: '0',
        COREPACK_ENABLE_NETWORK: '1',
        PKGSTEWARD_DATA_DIR: P.data,
      });
      const command = buildGlobalCommand(input(manager, { environment }));
      expect(command.env).toMatchObject({
        PATH: manager === 'pnpm' ? Q.bin : 'D:\\TEST\\bin',
        CI: '1',
        COREPACK_ENABLE_NETWORK: '0',
        COREPACK_ENABLE_AUTO_PIN: '0',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      });
      for (const key of Object.keys(command.env)) {
        expect(key).not.toMatch(
          /^(?:npm_|NODE_AUTH_TOKEN$|NODE_OPTIONS$|NODE_ENV$|PKGSTEWARD_DATA_DIR$)/i,
        );
        if (/^pnpm_config_/i.test(key))
          expect([
            'pnpm_config_verify_deps_before_run',
            'pnpm_config_update_notifier',
            'pnpm_config_npmrc_auth_file',
            'pnpm_config_cache_dir',
            'pnpm_config_state_dir',
            'pnpm_config_config_dir',
          ]).toContain(key);
      }
      expect(JSON.stringify(command)).not.toContain('TEST-not-a-token');
      if (manager === 'pnpm')
        expect(command.env).toMatchObject({
          PNPM_HOME: Q.home,
          pnpm_config_verify_deps_before_run: 'false',
          pnpm_config_update_notifier: 'false',
        });
      expect(environment.CI).toBe('0');
    },
  );
  it.each(['npm', 'pnpm'] as const)(
    'never adds unsafe convenience flags for %s',
    (manager) => {
      const args = buildGlobalCommand(input(manager)).args;
      for (const flag of [
        '--global=false',
        '--force',
        '--yes',
        '--ignore-scripts',
      ])
        expect(args).not.toContain(flag);
      expect(args.filter((arg) => arg === '--')).toHaveLength(1);
      expect(args).not.toContain('sudo');
      expect(args).not.toContain('runas');
    },
  );
  it('does not mutate a captured location or caller environment', () => {
    const request = input('npm');
    const before = JSON.stringify(request);
    Object.freeze(request.environment);
    Object.freeze(request.location);
    buildGlobalCommand(Object.freeze(request));
    expect(JSON.stringify(request)).toBe(before);
  });
  it.each([null, 'D:\\TEST\\npm.cmd', 'D:\\TEST\\corepack.exe'])(
    'rejects an unverified JS launcher %p',
    async (entry) => {
      const location = testLocation();
      location.tool = { ...location.tool, entry };
      await expectGlobalReason(
        () =>
          buildGlobalCommand(
            input('npm', {
              location,
            }),
          ),
        'TOOL_LAYOUT_UNSUPPORTED',
      );
    },
  );
});

describe('read-only query vectors', () => {
  it.each([
    ['npm', 'prefix', ['config', 'get', 'prefix']],
    ['npm', 'root', ['root', '--global']],
    ['npm', 'userconfig', ['config', 'get', 'userconfig']],
    ['npm', 'globalconfig', ['config', 'get', 'globalconfig']],
    ['npm', 'cache', ['config', 'get', 'cache']],
  ] satisfies [GlobalManager, GlobalQuery, string[]][])(
    '%s %s is a fixed argv array',
    (manager, query, tail) => {
      const tool = testTool(manager);
      const command = buildGlobalQuery({
        manager,
        tool,
        query,
        cwd: P.cwd,
        environment: {},
        captured: {},
      });
      expect(command).toMatchObject({ file: P.node, cwd: P.cwd });
      expect(command.args).toEqual([
        tool.entry,
        '--update-notifier=false',
        ...tail,
      ]);
    },
  );
  it.each(['npm', 'pnpm'] as const)(
    'pins %s list argv and captured CLI paths',
    (manager) => {
      const command = buildGlobalQuery({
        manager,
        tool: testTool(manager),
        query: 'list',
        cwd: P.cwd,
        environment: {
          npm_config_prefix: 'D:\\TEST\\wrong',
          ...(manager === 'pnpm' ? { PATH: Q.bin } : {}),
        },
        captured: {
          npm_config_prefix: P.prefix,
          npm_config_userconfig: P.userconfig,
          npm_config_globalconfig: P.globalconfig,
          npm_config_cache: P.cache,
          pnpm_config_global_dir: P.global,
          pnpm_config_global_bin_dir: P.bin,
          pnpm_config_store_dir: P.store,
          PNPM_HOME: P.bin,
        },
        pnpm: manager === 'pnpm' ? pnpmConfigFacts() : undefined,
      });
      const flags =
        manager === 'npm'
          ? [
              '--update-notifier=false',
              '--prefix',
              P.prefix,
              '--userconfig',
              P.userconfig,
              '--globalconfig',
              P.globalconfig,
              '--cache',
              P.cache,
            ]
          : ['--dir', P.cwd, '--pm-on-fail=warn'];
      expect(command.args).toEqual([
        testTool(manager).entry,
        ...flags,
        'list',
        '--global',
        ...(manager === 'pnpm' ? ['--global-dir', Q.global] : []),
        '--depth=0',
        '--json',
      ]);
      expect(command.env.npm_config_prefix).toBeUndefined();
      expect(command.args).not.toContain('--global=false');
    },
  );
  it('rejects a manager/query mismatch instead of a fallback', async () => {
    await expectGlobalReason(
      () =>
        buildGlobalQuery({
          manager: 'npm',
          tool: testTool('npm'),
          query: 'store',
          cwd: P.cwd,
          environment: {},
          captured: {},
        }),
      'CONFIG_UNSUPPORTED',
    );
  });
});

describe('pnpm 11 command boundary', () => {
  it.each([
    ['npmrcAuthFile', Q.auth], // pnpm-11.22.0.mjs:168168 path66
    ['cacheDir', Q.cache], // 168096 String
    ['stateDir', Q.state], // 168204 String
    ['configDir', Q.config], // 168102 String
    ['verifyDepsBeforeRun', false], // 168216 Boolean
    ['updateNotifier', false], // 168232 Boolean
  ] satisfies [string, string | boolean][])(
    'emits parsed schema-backed %s rather than ignored env (review F4)',
    (key, value) => {
      const command = buildGlobalCommand(
        input('pnpm', {
          location: pnpmLocation(
            pnpmConfigFacts({
              safety: {
                minimumReleaseAge: 4320,
                allowBuilds: { 'test-native': true },
              },
            }),
          ),
        }),
      );
      // 166500-166503: missing schema entries are silently skipped by pnpm.
      const consumed = consumePnpm11Environment(command.env);
      expect(consumed[key]).toBe(value);
      expect(
        Object.keys(command.env).filter((name) =>
          name.startsWith('pnpm_config_'),
        ),
      ).toHaveLength(Object.keys(consumed).length);
      expect(command.env.pnpm_config_allow_builds).toBeUndefined();
      expect(command.env.pnpm_config_minimum_release_age).toBeUndefined();
      expect(
        command.env.pnpm_config_minimum_release_age_strict,
      ).toBeUndefined();
    },
  );

  it('refuses change when static safety is unresolved instead of claiming an env deny (review F4)', async () => {
    const config = pnpmConfigFacts();
    config.policy.changeUnsupported = true;
    await expectGlobalReason(
      () =>
        buildGlobalCommand(input('pnpm', { location: pnpmLocation(config) })),
      'REGISTRY_CONFIG_UNSUPPORTED',
    );
  });
  it.each(['change', 'remove'] as const)(
    'pins the verified launcher and closed stdin for %s',
    (action) => {
      const command = buildGlobalCommand(
        input('pnpm', {
          action,
          exactVersion: action === 'change' ? '2.0.0' : null,
        }),
      );
      expect(command).toMatchObject({
        file: P.node,
        cwd: P.cwd,
        shell: false,
        extendEnv: false,
        stdin: 'ignore',
        env: { CI: '1', PNPM_HOME: Q.home },
      });
      expect(command.args[0]).toBe(testTool('pnpm').entry);
      expect(command.args).not.toContain('--userconfig');
      expect(command.args).not.toContain('--globalconfig');
      expect(command.env.PNPM_HOME).not.toBe(Q.bin);
    },
  );

  it.each([true, false])(
    'omits registry and global-bin-dir on remove, publicRegistry=%s',
    (publicRegistry) => {
      const command = buildGlobalCommand(
        input('pnpm', {
          action: 'remove',
          exactVersion: null,
          publicRegistry,
        }),
      );
      expect(command.args).toEqual([
        testTool('pnpm').entry,
        '--dir',
        P.cwd,
        '--pm-on-fail=warn',
        'remove',
        '--global',
        '--global-dir',
        Q.global,
        '--store-dir',
        Q.store,
        '--reporter=append-only',
        '--',
        '@test/tool',
      ]);
      expect(command.args).not.toContain('--global-bin-dir');
      expect(command.args).not.toContain('--registry');
    },
  );

  it('restores validated selectors without replacing original YAML safety with env', () => {
    const config = pnpmConfigFacts({
      safety: {
        minimumReleaseAge: 1440,
        minimumReleaseAgeStrict: true,
        allowBuilds: { 'test-native': false },
      },
    });
    const command = buildGlobalCommand(
      input('pnpm', {
        location: pnpmLocation(config),
        environment: {
          PATH: `.;relative;${Q.bin};C:\\Windows`,
          PNPM_HOME: Q.home,
          NODE_OPTIONS: '--require TEST.js',
          NPM_TOKEN: 'TEST-not-a-token',
          NODE_AUTH_TOKEN: 'TEST-not-a-token',
          COREPACK_NPM_TOKEN: 'TEST-not-a-token',
          PNPM_CONFIG__AUTH:
            '{"https://registry.npmjs.org/":{"@":{"authToken":"TEST-not-a-token"}}}',
          pnpm_config_dangerously_allow_all_builds: 'true',
          PNPM_CONFIG_IGNORE_SCRIPTS: 'true',
          pnpm_config_force: 'true',
          pnpm_config_yes: 'true',
          pnpm_config_minimum_release_age: '0',
          pnpm_config_allow_builds: '{"test-native":true}',
          npm_config_registry: 'https://private.invalid',
          pnpm_config_global_pnpmfile: 'D:\\TEST\\plugin.cjs',
          CI: '0',
        },
      }),
    );
    expect(command.env).toMatchObject({
      PNPM_HOME: Q.home,
      PATH: `${Q.bin};C:\\Windows`,
      CI: '1',
      pnpm_config_npmrc_auth_file: Q.auth,
      pnpm_config_cache_dir: Q.cache,
      pnpm_config_state_dir: Q.state,
      pnpm_config_config_dir: Q.config,
    });
    expect(JSON.stringify(command)).not.toMatch(
      /TEST-not-a-token|private\.invalid|plugin\.cjs/,
    );
    const keys = Object.keys(command.env).map((key) => key.toLowerCase());
    for (const key of [
      'node_options',
      'npm_token',
      'node_auth_token',
      'corepack_npm_token',
      'pnpm_config__auth',
      'pnpm_config_dangerously_allow_all_builds',
      'pnpm_config_ignore_scripts',
      'pnpm_config_force',
      'pnpm_config_yes',
      'pnpm_config_minimum_release_age',
      'pnpm_config_minimum_release_age_strict',
      'pnpm_config_allow_builds',
    ])
      expect(keys).not.toContain(key);
    expect(keys.some((key) => key.startsWith('npm_config_'))).toBe(false);
    expect(command.args).not.toEqual(
      expect.arrayContaining([
        '--ignore-scripts',
        '--dangerously-allow-all-builds',
        '--force',
        '--yes',
      ]),
    );
  });

  it.each(['9.15.9', '10.30.0', '12.0.0'])(
    'rejects unsupported major %s without fallback/probe',
    async (version) => {
      const location = pnpmLocation();
      location.tool = { ...location.tool, version };
      await expectGlobalReason(
        () => buildGlobalCommand(input('pnpm', { location })),
        'TOOL_VERSION_MISMATCH',
      );
      await expectGlobalReason(
        () =>
          buildGlobalQuery({
            manager: 'pnpm',
            tool: location.tool,
            cwd: P.cwd,
            query: 'list',
            captured: {},
            environment: { PATH: Q.bin },
            pnpm: location.pnpm,
          }),
        'TOOL_VERSION_MISMATCH',
      );
    },
  );

  it.each([
    'global-dir',
    'root',
    'bin',
    'store',
    'userconfig',
    'globalconfig',
  ] as const)(
    'refuses obsolete pnpm discovery query %s instead of spawning a fallback',
    async (query) => {
      await expectGlobalReason(
        () =>
          buildGlobalQuery({
            manager: 'pnpm',
            tool: testTool('pnpm'),
            cwd: P.cwd,
            query,
            captured: {},
            environment: { PATH: Q.bin },
            pnpm: pnpmConfigFacts(),
          }),
        'CONFIG_UNSUPPORTED',
      );
    },
  );

  it.each([
    [null, 'LOCATION_AMBIGUOUS'],
    ['relative', 'LOCATION_AMBIGUOUS'],
  ] satisfies [string | null, string][])(
    'requires a proven effective store for mutation: %p',
    async (storeDir, reason) => {
      const location = pnpmLocation(pnpmConfigFacts({ storeDir }));
      await expectGlobalReason(
        () => buildGlobalCommand(input('pnpm', { location })),
        reason,
      );
    },
  );

  it('does not fabricate PATH to repair setup', async () => {
    await expectGlobalReason(
      () =>
        buildGlobalCommand(
          input('pnpm', {
            environment: { PATH: '.;relative;C:\\Windows' },
          }),
        ),
      'PNPM_GLOBAL_NOT_CONFIGURED',
    );
  });

  it('requires pinned pnpm configuration instead of reusing old npm selectors', async () => {
    await expectGlobalReason(
      () =>
        buildGlobalCommand(
          input('pnpm', {
            location: testLocation('pnpm'),
          }),
        ),
      'CONFIG_UNSUPPORTED',
    );
  });

  it('rejects a mismatch between public location paths and pinned configuration', async () => {
    const location = pnpmLocation();
    location.globalDir = 'D:\\TEST\\other-global';
    await expectGlobalReason(
      () => buildGlobalCommand(input('pnpm', { location })),
      'LOCATION_AMBIGUOUS',
    );
  });

  it('does not mutate pinned facts or the caller environment', () => {
    const request = input('pnpm');
    const before = JSON.stringify(request);
    Object.freeze(request.environment);
    Object.freeze(request.location.pnpm);
    Object.freeze(request.location);
    buildGlobalCommand(Object.freeze(request));
    expect(JSON.stringify(request)).toBe(before);
  });
});
