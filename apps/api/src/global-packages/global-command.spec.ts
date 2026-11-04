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

const input = (
  manager: GlobalManager,
  patch: Partial<IGlobalMutationInput> = {},
): IGlobalMutationInput => ({
  location: testLocation(manager),
  environment: {},
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
    : [
        '--dir',
        P.cwd,
        '--pm-on-fail=warn',
        '--userconfig',
        P.userconfig,
        '--globalconfig',
        P.globalconfig,
        '--global-dir',
        P.global,
        '--global-bin-dir',
        P.bin,
        '--store-dir',
        P.store,
        '--registry',
        'https://registry.npmjs.org',
      ];

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
        PATH: `.;relative;D:\\TEST\\bin`,
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
        PATH: 'D:\\TEST\\bin',
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
          ]).toContain(key);
      }
      expect(JSON.stringify(command)).not.toContain('TEST-not-a-token');
      if (manager === 'pnpm')
        expect(command.env).toMatchObject({
          PNPM_HOME: P.bin,
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
    ['pnpm', 'global-dir', ['config', 'get', 'global-dir']],
    ['pnpm', 'root', ['root', '--global']],
    ['pnpm', 'bin', ['bin', '--global']],
    ['pnpm', 'store', ['store', 'path']],
    ['pnpm', 'userconfig', ['config', 'get', 'userconfig']],
    ['pnpm', 'globalconfig', ['config', 'get', 'globalconfig']],
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
        ...(manager === 'pnpm'
          ? ['--dir', P.cwd, '--pm-on-fail=warn']
          : ['--update-notifier=false']),
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
        environment: { npm_config_prefix: 'D:\\TEST\\wrong' },
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
          : [
              '--dir',
              P.cwd,
              '--pm-on-fail=warn',
              '--userconfig',
              P.userconfig,
              '--globalconfig',
              P.globalconfig,
              '--global-dir',
              P.global,
              '--global-bin-dir',
              P.bin,
              '--store-dir',
              P.store,
            ];
      expect(command.args).toEqual([
        testTool(manager).entry,
        ...flags,
        'list',
        '--global',
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
