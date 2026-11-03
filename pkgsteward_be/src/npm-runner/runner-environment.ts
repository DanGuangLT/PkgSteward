import type {
  IRunnerTool,
  RunAction,
  RunnerManager,
} from '@/npm-runner/interfaces/npm-runner.types';
import { SETTINGS_FILE_KEYS } from '@/config/env.validation';
import { isFullyQualifiedPath } from '@/common/utils/path.util';

// Action is explicit because A8 requires CI=1 for mutations only.
export function buildRunnerEnvironment(
  osSnapshot: Readonly<NodeJS.ProcessEnv>,
  tool: IRunnerTool,
  manager: RunnerManager,
  action: RunAction,
): NodeJS.ProcessEnv {
  void tool;
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
  };
  for (const [key, value] of Object.entries(forced)) {
    for (const existing of Object.keys(env))
      if (existing.toLowerCase() === key.toLowerCase()) delete env[existing];
    env[key] = value;
  }
  if (action !== 'script') env.CI = '1';
  return env;
}
