import type {
  GlobalEnvironmentCapture,
  IGlobalCommand,
  IGlobalResolvedLocation,
} from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalAction,
  GlobalManager,
} from '@/global-packages/interfaces/global-packages.types';
import type { IRunnerTool } from '@/npm-runner/interfaces/npm-runner.types';
import { win32 } from 'node:path';
import * as semver from 'semver';
import { AppException } from '@/common/exceptions/app.exception';
import { captureGlobalEnvironment } from '@/global-packages/global-config';
import {
  isGlobalPackageName,
  isGlobalTargetVersion,
} from '@/global-packages/global-policy';
import type { GlobalReasonCode } from '@/global-packages/interfaces/global-packages.types';
import { buildRunnerEnvironment } from '@/npm-runner/runner-environment';
import type { IPnpmGlobalConfig } from '@/global-packages/interfaces/pnpm-global.types';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org';
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

function assertLauncher(
  manager: GlobalManager,
  tool: IRunnerTool,
  cwd: string,
): void {
  if (manager !== 'npm' && manager !== 'pnpm')
    return fail('UNSUPPORTED_MANAGER');
  if (
    tool.manager !== manager ||
    !isGlobalExactVersion(tool.version) ||
    semver.major(tool.version) !== 11
  )
    return fail('TOOL_VERSION_MISMATCH');
  if (
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
  if (!isGlobalAbsolutePath(cwd)) return fail('CONFIG_UNSUPPORTED');
}

function environmentFor(
  snapshot: Readonly<NodeJS.ProcessEnv>,
  tool: IRunnerTool,
  manager: GlobalManager,
  action: GlobalAction,
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (
      /^(?:pnpm_config_|PNPM_HOME$|NODE_AUTH_TOKEN$|COREPACK_NPM_TOKEN$|YARN_)/i.test(
        key,
      )
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
  tool: IRunnerTool;
  cwd: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  captured: GlobalEnvironmentCapture;
  query: GlobalQuery | 'list';
  pnpm?: IPnpmGlobalConfig;
}
export interface IGlobalMutationInput {
  location: IGlobalResolvedLocation;
  environment: Readonly<NodeJS.ProcessEnv>;
  action: GlobalAction;
  packageName: string;
  exactVersion: string | null;
  publicRegistry: boolean;
}

export function buildGlobalQuery(input: IGlobalQueryInput): IGlobalCommand {
  const { manager, tool, cwd, query } = input;
  assertLauncher(manager, tool, cwd);
  if (manager === 'pnpm') return buildPnpmGlobalQuery(input);
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
    env: environmentFor(input.environment, tool, manager, 'remove'),
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
  if (manager === 'pnpm') return buildPnpmGlobalCommand(input);
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
    env: environmentFor(input.environment, tool, manager, action),
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
  return {
    file: location.tool.file,
    cwd: location.cwd,
    args: [
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
      action === 'change' ? `${packageName}@${exactVersion}` : packageName,
    ],
    env: pnpmEnvironment(input.environment, location.tool, action, config),
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
  return {
    file: input.tool.file,
    cwd: input.cwd,
    args: [
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
    env: pnpmEnvironment(input.environment, input.tool, 'remove', config),
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
  // Keep build/release policy in the original consumed YAML. In particular,
  // pnpm 11.22.0:166500-166503,168242-168245 silently ignores env allow-builds.
  return env;
}
