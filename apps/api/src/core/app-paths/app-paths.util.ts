import { existsSync } from 'fs';
import * as path from 'path';

export const APP_DATA_DIR_NAME = 'PkgSteward';
export const SETTINGS_FILE_NAME = 'settings.json';
export const AUDIT_LOG_FILE_NAME = 'dangerous-operations.jsonl';

export interface IDataDirSources {
  override?: string; // A validated absolute PKGSTEWARD_DATA_DIR, or undefined.
  localAppData?: string; // %LOCALAPPDATA%
  homeDir: string;
  platform: NodeJS.Platform;
}

// Runtime data uses an override for test/dev, or the user's local app data.
export const resolveDataDir = ({
  override,
  localAppData,
  homeDir,
  platform,
}: IDataDirSources): string => {
  const api = platform === 'win32' ? path.win32 : path.posix;
  if (override && override.trim() !== '') return api.resolve(override.trim());
  if (platform === 'win32') {
    const base =
      localAppData && localAppData.trim() !== ''
        ? localAppData
        : api.join(homeDir, 'AppData', 'Local');
    return api.join(base, APP_DATA_DIR_NAME);
  }
  // Non-Windows CI needs a valid path; the application targets Windows.
  return api.join(homeDir, '.local', 'share', APP_DATA_DIR_NAME);
};

// Resolve the package from __dirname in source or build output, independent of cwd.
export const findPackageRoot = (
  startDir: string,
  exists: (filePath: string) => boolean = existsSync,
): string => {
  let dir = path.resolve(startDir);
  for (;;) {
    if (exists(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot find package.json above ${startDir}`);
    }
    dir = parent;
  }
};

// A source checkout is laid out as <repo>/apps/<app> with .git in <repo>.
// Only that exact shape counts: walking further up could treat a user's own
// repository (PkgSteward installed inside it) as the source checkout.
// The name check ignores case: on Windows __dirname keeps the case typed in the shell.
export const findSourceCheckoutDir = (
  appInstallDir: string,
  exists: (filePath: string) => boolean = existsSync,
): string | null => {
  const apps = path.dirname(appInstallDir);
  if (path.basename(apps).toLowerCase() !== 'apps') return null;
  const repo = path.dirname(apps);
  return exists(path.join(repo, '.git')) ? repo : null;
};
