import type {
  IRunnerTool,
  RunAction,
  RunnerManager,
} from '@/npm-runner/interfaces/npm-runner.types';
import { SETTINGS_FILE_KEYS } from '@/config/environment/env.validation';
import { isFullyQualifiedPath } from '@/common/utils/path.util';
import * as semver from 'semver';

export function buildInteractiveShellEnv(
  osSnapshot: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const denied = new Set<string>([
    ...SETTINGS_FILE_KEYS,
    'NODE_ENV',
    'NODE_OPTIONS',
    'CI',
    'NO_COLOR',
    'FORCE_COLOR',
    'INIT_CWD',
    'PNPM_SCRIPT_SRC_DIR',
  ]);
  const directories = new Set([
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'SYSTEMROOT',
  ]);
  const env: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(osSnapshot)) {
    const upper = key.toUpperCase();
    if (
      seen.has(upper) ||
      denied.has(upper) ||
      upper.startsWith('PKGSTEWARD_') ||
      upper.startsWith('NODE_CHANNEL_') ||
      upper.startsWith('NPM_') ||
      upper.startsWith('PNPM_CONFIG_') ||
      ['__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE'].includes(upper) ||
      typeof value !== 'string' ||
      /[\0\r\n]/.test(value)
    )
      continue;
    if (directories.has(upper) && !isFullyQualifiedPath(value, 'win32'))
      continue;
    seen.add(upper);
    if (upper === 'PATH') {
      env.PATH = value
        .split(';')
        .filter((entry) => isFullyQualifiedPath(entry, 'win32'))
        .join(';');
    } else env[key] = value;
  }
  return env;
}

// Action is explicit because A8 requires CI=1 for mutations only.
export function buildRunnerEnvironment(
  osSnapshot: Readonly<NodeJS.ProcessEnv>,
  tool: IRunnerTool,
  manager: RunnerManager,
  action: RunAction,
): NodeJS.ProcessEnv {
  const denied = new Set([
    ...SETTINGS_FILE_KEYS,
    'PKGSTEWARD_DATA_DIR',
    'NODE_ENV',
    'NODE_OPTIONS',
    'INIT_CWD',
    'PNPM_SCRIPT_SRC_DIR',
  ]);
  const env: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(osSnapshot)) {
    const upper = key.toUpperCase();
    if (
      seen.has(upper) ||
      denied.has(upper) ||
      upper.startsWith('NPM_') ||
      upper.startsWith('PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT') ||
      value === undefined
    )
      continue;
    seen.add(upper);
    if (upper === 'PATH') {
      env.PATH = value
        .split(';')
        .filter(
          (entry) =>
            isFullyQualifiedPath(entry, 'win32') &&
            !entry.includes('\0') &&
            !entry.includes('\r') &&
            !entry.includes('\n'),
        )
        .join(';');
    } else env[upper === 'CI' ? 'CI' : key] = value;
  }
  const forced: NodeJS.ProcessEnv = {
    NoDefaultCurrentDirectoryInExePath: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    COREPACK_ENABLE_NETWORK: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    // pnpm 11.22 rejects these as CLI flags (RT1); its env config prefix is
    // pnpm_config_. Default verify-deps-before-run=install made a script run
    // also install and run lifecycle scripts.
    ...(manager === 'pnpm'
      ? {
          pnpm_config_verify_deps_before_run: 'false',
          pnpm_config_update_notifier: 'false',
        }
      : {}),
    // pnpm 10.34.9 reads env config as npm_config_* (above the project .npmrc) and
    // applies pnpm_config_verify_deps_before_run only inside a workspace.
    ...(manager === 'pnpm' && semver.parse(tool.version)?.major === 10
      ? {
          npm_config_verify_deps_before_run: 'false',
          npm_config_update_notifier: 'false',
        }
      : {}),
  };
  for (const [key, value] of Object.entries(forced)) {
    for (const existing of Object.keys(env))
      if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
    env[key] = value;
  }
  if (action !== 'script') env.CI = '1';
  const compat = tool.npm10InstallCompat;
  if (
    manager === 'npm' &&
    tool.manager === 'npm' &&
    semver.parse(tool.version)?.major === 10 &&
    action === 'install_all' &&
    compat?.supported &&
    compat.revision === 1 &&
    tool.entry
  ) {
    env.PKGSTEWARD_RUNNER_NPM10_INSTALL_COMPAT = JSON.stringify({
      schema: 1,
      entry: tool.entry,
      version: tool.version,
      sourceSha256: compat.sourceSha256,
      loaderSha256: compat.loaderSha256,
      preloadSha256: compat.preloadSha256,
    });
  }
  return env;
}
