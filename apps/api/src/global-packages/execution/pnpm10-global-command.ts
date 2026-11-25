import type { IGlobalCommand } from '@/global-packages/interfaces/global-packages.runtime';
import type {
  IGlobalMutationInput,
  IGlobalQueryInput,
} from '@/global-packages/execution/global-command';
import type { IPnpm10GlobalConfig } from '@/global-packages/interfaces/pnpm10-global.types';
import { AppException } from '@/common/exceptions/app.exception';
import { win32 } from 'node:path';
import {
  environmentFor,
  isGlobalAbsolutePath,
  isGlobalExactVersion,
} from '@/global-packages/execution/global-command';
import { isGlobalPackageName } from '@/global-packages/policy/global-policy';

const fail = (reason: string): never => {
  throw new AppException(409, 'pnpm 10 command refused', 'CONFLICT', {
    reason,
  });
};
const key = (path: string) => win32.resolve(path).toLowerCase();
const selector =
  /^(?:PNPM_HOME|XDG_(?:DATA|CACHE|STATE|CONFIG)_HOME|LOCALAPPDATA|APPDATA|USERPROFILE|HOME|npm_config_(?:userconfig|globalconfig|prefix|global_dir|global_bin_dir|store_dir|cache_dir|state_dir|config_dir|cache))$/i;
const pathSelectors: Readonly<Record<string, string>> = {
  npm_config_globaldir: 'npm_config_global_dir',
  npm_config_globalbindir: 'npm_config_global_bin_dir',
  npm_config_storedir: 'npm_config_store_dir',
  npm_config_cachedir: 'npm_config_cache_dir',
  npm_config_statedir: 'npm_config_state_dir',
};

function command(
  input: Pick<IGlobalQueryInput, 'tool' | 'cwd' | 'environment'>,
  config: IPnpm10GlobalConfig,
  tail: string[],
): IGlobalCommand {
  const { tool, cwd } = input;
  if (tool.manager !== 'pnpm' || !/^10\.\d+\.\d+$/.test(tool.version))
    return fail('TOOL_VERSION_MISMATCH');
  if (
    !tool.entry ||
    !isGlobalAbsolutePath(tool.entry) ||
    !isGlobalAbsolutePath(tool.file) ||
    win32.basename(tool.file).toLowerCase() !== 'node.exe' ||
    !/\.(?:cjs|mjs|js)$/i.test(tool.entry) ||
    !isGlobalAbsolutePath(tool.packageDir) ||
    !key(tool.entry).startsWith(`${key(tool.packageDir)}\\`)
  )
    return fail('TOOL_LAYOUT_UNSUPPORTED');
  if (
    ![cwd, config.globalDir, config.globalRoot, config.binDir].every(
      isGlobalAbsolutePath,
    )
  )
    return fail('LOCATION_AMBIGUOUS');
  const clean = Object.fromEntries(
    Object.entries(input.environment).filter(([name]) => !selector.test(name)),
  );
  const env = environmentFor(
    clean,
    { ...tool, manager: 'pnpm' },
    'pnpm',
    'remove',
  );
  for (const name of Object.keys(env))
    if (
      /^(?:npm_config_|pnpm_config_)/i.test(name) &&
      !/^(?:pnpm_config_verify_deps_before_run|npm_config_update_notifier)$/i.test(
        name,
      )
    )
      delete env[name];
  for (const [name, value] of Object.entries(config.selectors)) {
    // The reader canonicalizes option names by removing punctuation. Restore
    // their consumed npm env spelling (pnpm replaces underscores with hyphens).
    const consumedName = pathSelectors[name.toLowerCase()] ?? name;
    if (!selector.test(consumedName) || !isGlobalAbsolutePath(value))
      return fail('CONFIG_UNSUPPORTED');
    env[consumedName] = value;
  }
  if (
    !config.originalPath.length ||
    config.originalPath.some((p) => !isGlobalAbsolutePath(p)) ||
    !config.originalPath.some((p) => key(p) === key(config.binDir))
  )
    return fail('PNPM_GLOBAL_NOT_CONFIGURED');
  env.PATH = config.originalPath.join(';');
  return {
    file: tool.file,
    cwd,
    args: [
      tool.entry,
      '--dir',
      cwd,
      '--config.manage-package-manager-versions=false',
      ...tail,
    ],
    env,
    shell: false,
    extendEnv: false,
    stdin: 'ignore',
  };
}

export function buildPnpm10GlobalCommand(
  input: IGlobalMutationInput,
): IGlobalCommand {
  const { location, action, packageName, exactVersion } = input;
  const config = location.pnpm10;
  if (!config) return fail('CONFIG_UNSUPPORTED');
  if (
    !isGlobalPackageName(packageName) ||
    (action === 'change'
      ? !isGlobalExactVersion(exactVersion)
      : action !== 'remove' || exactVersion !== null)
  )
    return fail('INVALID_PACKAGE_SPEC');
  if (
    action === 'change' &&
    (!input.publicRegistry ||
      config.policy.changeUnsupported ||
      config.policy.unknownRouting)
  )
    return fail('REGISTRY_CONFIG_UNSUPPORTED');
  const store = input.pnpm10Inventory?.project.storeDir;
  if (
    !store ||
    !input.pnpm10Inventory?.project.storeIdentity ||
    !isGlobalAbsolutePath(store)
  )
    return fail('INVENTORY_FAILED');
  for (const [actual, pinned] of [
    [location.globalDir, config.globalDir],
    [location.globalRoot, config.globalRoot],
    [location.binDir, config.binDir],
    [location.userConfig, config.userConfig],
    [location.globalConfig, config.globalConfig],
  ])
    if (!actual || !pinned || key(actual) !== key(pinned))
      return fail('LOCATION_AMBIGUOUS');
  return command({ ...input, tool: location.tool, cwd: location.cwd }, config, [
    action === 'change' ? 'add' : 'remove',
    '--global',
    '--global-dir',
    config.globalDir,
    ...(action === 'change' ? ['--global-bin-dir', config.binDir] : []),
    '--store-dir',
    store,
    ...(action === 'change'
      ? ['--registry', 'https://registry.npmjs.org']
      : []),
    '--reporter=append-only',
    '--',
    action === 'change' ? `${packageName}@${exactVersion}` : packageName,
  ]);
}
export function buildPnpm10GlobalQuery(
  input: IGlobalQueryInput,
): IGlobalCommand {
  if (!input.pnpm10 || input.query !== 'list')
    return fail('CONFIG_UNSUPPORTED');
  return command(input, input.pnpm10, [
    'list',
    '--global',
    '--global-dir',
    input.pnpm10.globalDir,
    '--depth=0',
    '--json',
  ]);
}
