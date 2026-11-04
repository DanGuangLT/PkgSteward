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
  bin?: string,
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
  if (manager === 'pnpm' && bin) env.PNPM_HOME = bin;
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
  const captured = captureGlobalEnvironment(input.captured);
  const paths: [string, string | undefined][] = [
    ...(manager === 'npm'
      ? [
          ['--prefix', captured.npm_config_prefix] as [
            string,
            string | undefined,
          ],
        ]
      : []),
    ['--userconfig', captured.npm_config_userconfig],
    ['--globalconfig', captured.npm_config_globalconfig],
    ...(manager === 'npm'
      ? [['--cache', captured.npm_config_cache] as [string, string | undefined]]
      : ([
          ['--global-dir', captured.pnpm_config_global_dir],
          ['--global-bin-dir', captured.pnpm_config_global_bin_dir],
          ['--store-dir', captured.pnpm_config_store_dir],
        ] as [string, string | undefined][])),
  ];
  const argv: Partial<Record<GlobalQuery | 'list', string[]>> = {
    list: ['list', '--global', '--depth=0', '--json'],
    root: ['root', '--global'],
    userconfig: ['config', 'get', 'userconfig'],
    globalconfig: ['config', 'get', 'globalconfig'],
    ...(manager === 'npm'
      ? {
          prefix: ['config', 'get', 'prefix'],
          cache: ['config', 'get', 'cache'],
        }
      : {
          'global-dir': ['config', 'get', 'global-dir'],
          bin: ['bin', '--global'],
          store: ['store', 'path'],
        }),
  };
  const tail = argv[query];
  if (!tail) return fail('CONFIG_UNSUPPORTED');
  return {
    file: tool.file,
    cwd,
    args: [
      tool.entry!,
      ...(manager === 'npm'
        ? ['--update-notifier=false']
        : ['--dir', cwd, '--pm-on-fail=warn']),
      ...paths.flatMap(([flag, path]) =>
        path === undefined ? [] : [flag, path],
      ),
      ...tail,
    ],
    env: environmentFor(
      input.environment,
      tool,
      manager,
      'remove',
      captured.PNPM_HOME ?? captured.pnpm_config_global_bin_dir,
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
  const paths =
    manager === 'npm'
      ? [
          location.prefix,
          location.userConfig,
          location.globalConfig,
          location.cacheDir,
        ]
      : [
          location.userConfig,
          location.globalConfig,
          location.globalDir,
          location.binDir,
          location.storeDir,
        ];
  if (paths.some((value) => !value || !isGlobalAbsolutePath(value)))
    return fail('LOCATION_AMBIGUOUS');
  const common =
    manager === 'npm'
      ? [
          '--prefix',
          location.prefix!,
          '--userconfig',
          location.userConfig,
          '--globalconfig',
          location.globalConfig,
          '--cache',
          location.cacheDir!,
        ]
      : [
          '--dir',
          cwd,
          '--pm-on-fail=warn',
          '--userconfig',
          location.userConfig,
          '--globalconfig',
          location.globalConfig,
          '--global-dir',
          location.globalDir!,
          '--global-bin-dir',
          location.binDir,
          '--store-dir',
          location.storeDir!,
        ];
  if (input.publicRegistry) common.push('--registry', PUBLIC_REGISTRY);
  if (manager === 'npm')
    common.push(
      '--no-audit',
      '--no-fund',
      '--no-progress',
      '--update-notifier=false',
    );
  const verb =
    manager === 'npm'
      ? action === 'remove'
        ? 'uninstall'
        : 'install'
      : action === 'remove'
        ? 'remove'
        : 'add';
  return {
    file: tool.file,
    cwd,
    args: [
      tool.entry!,
      ...common,
      verb,
      '--global',
      ...(manager === 'pnpm' ? ['--reporter=append-only'] : []),
      '--',
      action === 'remove' ? packageName : `${packageName}@${exactVersion}`,
    ],
    env: environmentFor(
      input.environment,
      tool,
      manager,
      action,
      location.binDir,
    ),
  };
}
