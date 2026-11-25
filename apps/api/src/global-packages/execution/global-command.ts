import type {
  GlobalEnvironmentCapture,
  IGlobalCommand,
  IGlobalResolvedLocation,
  IGlobalTool,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalAction,
  GlobalManager,
} from '@/global-packages/interfaces/global-packages.types';
import type { IRunnerTool } from '@/npm-runner/interfaces/npm-runner.types';
import { win32 } from 'node:path';
import * as semver from 'semver';
import { AppException } from '@/common/exceptions/app.exception';
import { captureGlobalEnvironment } from '@/global-packages/config/global-config';
import {
  isGlobalPackageName,
  isGlobalTargetVersion,
} from '@/global-packages/policy/global-policy';
import type { GlobalReasonCode } from '@/global-packages/interfaces/global-packages.types';
import { buildRunnerEnvironment } from '@/npm-runner/toolchain/runner-environment';
import { isSupportedRunnerVersion } from '@/npm-runner/toolchain/runner-version-policy';
import type { IPnpmGlobalConfig } from '@/global-packages/interfaces/pnpm-global.types';
import type {
  IPnpm10GlobalConfig,
  IPnpm10GlobalInventoryFacts,
} from '@/global-packages/interfaces/pnpm10-global.types';
import {
  buildPnpm10GlobalCommand,
  buildPnpm10GlobalQuery,
} from '@/global-packages/execution/pnpm10-global-command';
import {
  assertYarnLauncher,
  buildYarnGlobalCommand,
} from '@/global-packages/execution/yarn-global-command';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org';
// pnpm 11.22.0:214230-214250,272082: auto-approval ignores non-TTY consent.
// 31685/304141,52491/297086,55739,36066: test platform/fs overrides.
// 254775-254789: TABTAB_DEBUG opens an arbitrary append destination.
// 20914,255492,205067,206407: parser/loader debug;290154: TLS verification.
const UNSAFE_CHILD_ENVIRONMENT = new Set([
  '_ISEXE_TEST_PLATFORM_',
  '__MINIMATCH_TESTING_PLATFORM__',
  '__IS_WSL_TEST__',
  'TEST_GRACEFUL_FS_GLOBAL_PATCH',
  'TABTAB_DEBUG',
  'DEBUG',
  'DEBUG_CLI',
  'DEBUG_NOPT',
  'NOPT_DEBUG',
  'TINYGLOBBY_DEBUG',
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'PNP_DEBUG_LEVEL',
  'NM_DEBUG_LEVEL',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_PATH',
]);
const fail = (reason: GlobalReasonCode): never => {
  throw new AppException(
    reason === 'INVALID_PACKAGE_SPEC' ? 400 : 409,
    'Global command is unsupported',
    reason === 'INVALID_PACKAGE_SPEC' ? 'VALIDATION_ERROR' : 'CONFLICT',
    { reason },
  );
};
export const isGlobalExactVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  isGlobalTargetVersion(value) &&
  semver.valid(value) !== null;

/**
 * pnpm 10, 11 and 12 layouts have global adapters. pnpm 11 keeps its earlier
 * gate (prereleases included, as in the runner policy); pnpm 10 and 12 are
 * stable-only.
 */
export const isPnpmGlobalVersion = (version: string): boolean => {
  const parsed = semver.parse(version);
  return (
    !!parsed &&
    (parsed.major === 11 ||
      ((parsed.major === 10 || parsed.major === 12) &&
        parsed.prerelease.length === 0))
  );
};

const hasControl = (value: string): boolean =>
  Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
export const isGlobalAbsolutePath = (value: string): boolean =>
  value.length > 3 &&
  value.length <= 32767 &&
  /^[a-z]:[\\/]/i.test(value) &&
  !hasControl(value) &&
  !/[<>"|?*]/.test(value) &&
  !value.slice(2).includes(':') &&
  !value.includes('${') &&
  !value.includes('$(') &&
  !value.includes('`') &&
  !value
    .replace(/\\/g, '/')
    .split('/')
    .some((part) => /[. ]$/.test(part));

export function assertGlobalLauncher(
  manager: GlobalManager,
  tool: IGlobalTool,
): void {
  if (manager === 'yarn') {
    assertYarnLauncher(tool);
    return;
  }
  if (manager !== 'npm' && manager !== 'pnpm')
    return fail('UNSUPPORTED_MANAGER');
  if (
    tool.manager !== manager ||
    !isGlobalExactVersion(tool.version) ||
    !isSupportedRunnerVersion(manager, tool.version) ||
    (manager === 'pnpm' && !isPnpmGlobalVersion(tool.version))
  )
    return fail('TOOL_VERSION_MISMATCH');
  const isPnpm12 =
    manager === 'pnpm' && semver.parse(tool.version)?.major === 12;
  if (isPnpm12) {
    if (
      tool.entry !== null ||
      !isGlobalAbsolutePath(tool.file) ||
      !/\.exe$/i.test(tool.file) ||
      win32.basename(tool.file).toLowerCase() === 'node.exe' ||
      !isGlobalAbsolutePath(tool.packageDir) ||
      !win32
        .resolve(tool.file)
        .toLowerCase()
        .startsWith(`${win32.resolve(tool.packageDir).toLowerCase()}\\`)
    )
      return fail('TOOL_LAYOUT_UNSUPPORTED');
  } else if (
    !isGlobalAbsolutePath(tool.file) ||
    win32.basename(tool.file).toLowerCase() !== 'node.exe' ||
    !tool.entry ||
    !isGlobalAbsolutePath(tool.entry) ||
    !/\.(?:mjs|cjs|js)$/i.test(tool.entry) ||
    !isGlobalAbsolutePath(tool.packageDir) ||
    !win32
      .resolve(tool.entry)
      .toLowerCase()
      .startsWith(`${win32.resolve(tool.packageDir).toLowerCase()}\\`)
  )
    return fail('TOOL_LAYOUT_UNSUPPORTED');
}

function assertLauncher(
  manager: GlobalManager,
  tool: IGlobalTool,
  cwd: string,
): void {
  assertGlobalLauncher(manager, tool);
  if (!isGlobalAbsolutePath(cwd)) return fail('CONFIG_UNSUPPORTED');
}

function asRunnerTool(
  tool: IGlobalTool,
  manager: Extract<GlobalManager, 'npm' | 'pnpm'>,
): IRunnerTool {
  if (tool.manager !== manager) return fail('TOOL_LAYOUT_UNSUPPORTED');
  return { ...tool, manager };
}

export function environmentFor(
  snapshot: Readonly<NodeJS.ProcessEnv>,
  tool: IRunnerTool,
  manager: Extract<GlobalManager, 'npm' | 'pnpm'>,
  action: GlobalAction,
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (
      // Remove every inherited PNPM_* input, including mixed-case test/internal
      // switches. Only validated home/config selectors are restored below.
      /^(?:PNPM_|NODE_AUTH_TOKEN$|COREPACK_NPM_TOKEN$|YARN_)/i.test(key) ||
      UNSAFE_CHILD_ENVIRONMENT.has(key.toUpperCase())
    )
      continue;
    clean[key] = value;
  }
  const env = buildRunnerEnvironment(
    clean,
    tool,
    manager,
    action === 'remove' ? 'uninstall_one' : 'install_one',
  );
  return env;
}

export type GlobalQuery =
  | 'prefix'
  | 'root'
  | 'userconfig'
  | 'globalconfig'
  | 'cache'
  | 'global-dir'
  | 'bin'
  | 'store';

export interface IGlobalQueryInput {
  manager: GlobalManager;
  tool: IGlobalTool;
  cwd: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  captured: GlobalEnvironmentCapture;
  query: GlobalQuery | 'list';
  pnpm?: IPnpmGlobalConfig;
  pnpm10?: IPnpm10GlobalConfig;
}
export interface IGlobalMutationInput {
  location: IGlobalResolvedLocation;
  environment: Readonly<NodeJS.ProcessEnv>;
  action: GlobalAction;
  packageName: string;
  exactVersion: string | null;
  publicRegistry: boolean;
  pnpm10Inventory?: IPnpm10GlobalInventoryFacts;
}

export function buildGlobalQuery(input: IGlobalQueryInput): IGlobalCommand {
  const { manager, tool, cwd, query } = input;
  assertLauncher(manager, tool, cwd);
  if (manager === 'yarn') return fail('CONFIG_UNSUPPORTED');
  if (manager === 'pnpm')
    return semver.parse(tool.version)?.major === 10
      ? buildPnpm10GlobalQuery(input)
      : buildPnpmGlobalQuery(input);
  const captured = captureGlobalEnvironment(input.captured);
  const paths: [string, string | undefined][] = [
    ['--prefix', captured.npm_config_prefix],
    ['--userconfig', captured.npm_config_userconfig],
    ['--globalconfig', captured.npm_config_globalconfig],
    ['--cache', captured.npm_config_cache],
  ];
  const argv: Partial<Record<GlobalQuery | 'list', string[]>> = {
    list: ['list', '--global', '--depth=0', '--json'],
    root: ['root', '--global'],
    userconfig: ['config', 'get', 'userconfig'],
    globalconfig: ['config', 'get', 'globalconfig'],
    prefix: ['config', 'get', 'prefix'],
    cache: ['config', 'get', 'cache'],
  };
  const tail = argv[query];
  if (!tail) return fail('CONFIG_UNSUPPORTED');
  return {
    file: tool.file,
    cwd,
    args: [
      tool.entry!,
      '--update-notifier=false',
      ...paths.flatMap(([flag, path]) =>
        path === undefined ? [] : [flag, path],
      ),
      ...tail,
    ],
    env: environmentFor(
      input.environment,
      asRunnerTool(tool, manager),
      manager,
      'remove',
    ),
  };
}

export function buildGlobalCommand(
  input: IGlobalMutationInput,
): IGlobalCommand {
  const { location, action, packageName, exactVersion } = input;
  const { tool, manager, cwd } = location;
  assertLauncher(manager, tool, cwd);
  if (
    !isGlobalPackageName(packageName) ||
    (action === 'change'
      ? !isGlobalExactVersion(exactVersion)
      : action !== 'remove' || exactVersion !== null)
  )
    return fail('INVALID_PACKAGE_SPEC');
  if (action === 'change' && !input.publicRegistry)
    return fail('REGISTRY_CONFIG_UNSUPPORTED');
  if (manager === 'yarn') {
    if (!location.yarn) return fail('CONFIG_UNSUPPORTED');
    if (action === 'repair') return fail('INVALID_PACKAGE_SPEC');
    return buildYarnGlobalCommand(
      {
        location,
        environment: input.environment,
        action,
        packageName,
        exactVersion,
        publicRegistry: input.publicRegistry,
      },
      location.yarn,
    );
  }
  if (manager === 'pnpm')
    return semver.parse(tool.version)?.major === 10
      ? buildPnpm10GlobalCommand(input)
      : buildPnpmGlobalCommand(input);
  const paths = [
    location.prefix,
    location.userConfig,
    location.globalConfig,
    location.cacheDir,
  ];
  if (paths.some((value) => !value || !isGlobalAbsolutePath(value)))
    return fail('LOCATION_AMBIGUOUS');
  const common = [
    '--prefix',
    location.prefix!,
    '--userconfig',
    location.userConfig,
    '--globalconfig',
    location.globalConfig,
    '--cache',
    location.cacheDir!,
  ];
  if (input.publicRegistry) common.push('--registry', PUBLIC_REGISTRY);
  common.push(
    '--no-audit',
    '--no-fund',
    '--no-progress',
    '--update-notifier=false',
  );
  const verb = action === 'remove' ? 'uninstall' : 'install';
  return {
    file: tool.file,
    cwd,
    args: [
      tool.entry!,
      ...common,
      verb,
      '--global',
      '--',
      action === 'remove' ? packageName : `${packageName}@${exactVersion}`,
    ],
    env: environmentFor(
      input.environment,
      asRunnerTool(tool, manager),
      manager,
      action,
    ),
  };
}

// pnpm 11 commands use pinned configuration rather than npm's config flags.
function buildPnpmGlobalCommand(input: IGlobalMutationInput): IGlobalCommand {
  const { location, action, packageName, exactVersion } = input;
  const config = location.pnpm;
  if (!config) return fail('CONFIG_UNSUPPORTED');
  if (
    action === 'change' &&
    (config.policy.changeUnsupported || config.policy.unknownRouting)
  )
    return fail('REGISTRY_CONFIG_UNSUPPORTED');
  const paths = [
    config.homeDir,
    config.globalDir,
    config.globalRoot,
    config.binDir,
    config.storeDir,
    config.cacheDir,
    config.stateDir,
    config.configDir,
    config.authFile,
  ];
  if (paths.some((path) => !path || !isGlobalAbsolutePath(path)))
    return fail('LOCATION_AMBIGUOUS');
  for (const [actual, pinned] of [
    [location.globalDir, config.globalDir],
    [location.globalRoot, config.globalRoot],
    [location.binDir, config.binDir],
    [location.storeDir, config.storeDir],
    [location.cacheDir, config.cacheDir],
    [location.userConfig, config.authFile],
  ]) {
    if (!actual || !pinned || comparable(actual) !== comparable(pinned))
      return fail('LOCATION_AMBIGUOUS');
  }
  const isPnpm12 = semver.parse(location.tool.version)?.major === 12;
  const target =
    action === 'change' ? `${packageName}@${exactVersion}` : packageName;
  const args = isPnpm12
    ? [
        '--dir',
        location.cwd,
        '--pm-on-fail=warn',
        '--store-dir',
        config.storeDir!,
        '--state-dir',
        config.stateDir,
        '--npmrc-auth-file',
        config.authFile,
        `--config.global-dir=${config.globalDir}`,
        `--config.global-bin-dir=${config.binDir}`,
        `--config.cache-dir=${config.cacheDir}`,
        `--config.config-dir=${config.configDir}`,
        action === 'change' ? 'add' : 'remove',
        '--global',
        ...(action === 'change' ? ['--registry', PUBLIC_REGISTRY] : []),
        '--reporter=append-only',
        '--',
        target,
      ]
    : [
        location.tool.entry!,
        '--dir',
        location.cwd,
        '--pm-on-fail=warn',
        action === 'change' ? 'add' : 'remove',
        '--global',
        '--global-dir',
        config.globalDir,
        ...(action === 'change' ? ['--global-bin-dir', config.binDir] : []),
        '--store-dir',
        config.storeDir!,
        ...(action === 'change' ? ['--registry', PUBLIC_REGISTRY] : []),
        '--reporter=append-only',
        '--',
        target,
      ];
  return {
    file: location.tool.file,
    cwd: location.cwd,
    args,
    env: pnpmEnvironment(
      input.environment,
      asRunnerTool(location.tool, 'pnpm'),
      action,
      config,
    ),
    shell: false,
    extendEnv: false,
    stdin: 'ignore',
  };
}

function buildPnpmGlobalQuery(input: IGlobalQueryInput): IGlobalCommand {
  const config = input.pnpm;
  if (!config) return fail('CONFIG_UNSUPPORTED');
  if (input.query !== 'list') return fail('CONFIG_UNSUPPORTED');
  if (!isGlobalAbsolutePath(config.globalDir))
    return fail('LOCATION_AMBIGUOUS');
  const isPnpm12 = semver.parse(input.tool.version)?.major === 12;
  return {
    file: input.tool.file,
    cwd: input.cwd,
    args: isPnpm12
      ? [
          '--dir',
          input.cwd,
          '--pm-on-fail=warn',
          `--config.global-dir=${config.globalDir}`,
          'list',
          '--global',
          '--depth=0',
          '--json',
        ]
      : [
          input.tool.entry!,
          '--dir',
          input.cwd,
          '--pm-on-fail=warn',
          'list',
          '--global',
          '--global-dir',
          config.globalDir,
          '--depth=0',
          '--json',
        ],
    env: pnpmEnvironment(
      input.environment,
      asRunnerTool(input.tool, 'pnpm'),
      'remove',
      config,
    ),
    shell: false,
    extendEnv: false,
    stdin: 'ignore',
  };
}

const comparable = (path: string): string => win32.resolve(path).toLowerCase();

function pnpmEnvironment(
  snapshot: Readonly<NodeJS.ProcessEnv>,
  tool: IRunnerTool,
  action: GlobalAction,
  config: IPnpmGlobalConfig,
): NodeJS.ProcessEnv {
  const env = environmentFor(snapshot, tool, 'pnpm', action);
  if (
    !env.PATH?.split(';').some(
      (path) => comparable(path) === comparable(config.binDir),
    )
  )
    return fail('PNPM_GLOBAL_NOT_CONFIGURED');
  env.PNPM_HOME = config.homeDir;
  env.pnpm_config_npmrc_auth_file = config.authFile;
  env.pnpm_config_cache_dir = config.cacheDir;
  env.pnpm_config_state_dir = config.stateDir;
  env.pnpm_config_config_dir = config.configDir;
  if (semver.parse(tool.version)?.major === 12) {
    env.pnpm_config_global_dir = config.globalDir;
    env.pnpm_config_global_bin_dir = config.binDir;
    if (config.storeDir) env.pnpm_config_store_dir = config.storeDir;
    env.pnpm_config_manage_package_manager_versions = 'false';
  }
  // Keep build/release policy in the original consumed YAML. In particular,
  // pnpm 11.22.0:166500-166503,168242-168245 silently ignores env allow-builds.
  return env;
}
