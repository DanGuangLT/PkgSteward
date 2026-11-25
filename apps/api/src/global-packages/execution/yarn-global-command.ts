import { win32 } from 'node:path';
import * as semver from 'semver';
import { AppException } from '@/common/exceptions/app.exception';
import { SETTINGS_FILE_KEYS } from '@/config/environment/env.validation';
import {
  isFullyQualifiedPath,
  isSameOrInside,
  toComparable,
} from '@/common/utils/path.util';
import type {
  IGlobalCommand,
  IGlobalResolvedLocation,
  IGlobalTool,
} from '@/global-packages/interfaces/global-packages.runtime';
import type { GlobalReasonCode } from '@/global-packages/interfaces/global-packages.types';
import type { IYarnGlobalConfig } from '@/global-packages/interfaces/yarn-global.types';
import { isGlobalPackageName } from '@/global-packages/policy/global-policy';
import type {
  IRunnerFileIdentity,
  IRunnerFs,
  IRunnerToolSnapshot,
  RunFailureCode,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  readRunnerFile,
  runnerFailure,
  runnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';
import {
  isProjectRecord,
  jsonDepthWithinLimit,
} from '@/projects/locks/project-lock-common';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org';
const YARN_UNSAFE_CHILD_ENV = new Set([
  ...SETTINGS_FILE_KEYS,
  'PKGSTEWARD_DATA_DIR',
  'NODE_ENV',
  'NODE_OPTIONS',
  'INIT_CWD',
  'PNPM_SCRIPT_SRC_DIR',
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
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'COREPACK_NPM_TOKEN',
  'PREFIX',
]);

export interface IYarnMutationInput {
  location: IGlobalResolvedLocation;
  environment: Readonly<NodeJS.ProcessEnv>;
  action: 'change' | 'remove';
  packageName: string;
  exactVersion: string | null;
  publicRegistry: boolean;
}

const commandFail = (reason: GlobalReasonCode): never => {
  throw new AppException(
    reason === 'INVALID_PACKAGE_SPEC' ? 400 : 409,
    'Global command is unsupported',
    reason === 'INVALID_PACKAGE_SPEC' ? 'VALIDATION_ERROR' : 'CONFLICT',
    { reason },
  );
};

const hasControl = (value: string): boolean =>
  Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

const isAbsoluteSafePath = (value: string): boolean =>
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

const key = (path: string): string => win32.resolve(path).toLowerCase();

export function isYarnGlobalVersion(version: string): boolean {
  const parsed = semver.parse(version);
  if (!parsed) return false;
  const canonical =
    parsed.version + (parsed.build.length ? `+${parsed.build.join('.')}` : '');
  return (
    canonical === version &&
    parsed.major === 1 &&
    parsed.prerelease.length === 0
  );
}

export function assertYarnLauncher(tool: IGlobalTool): void {
  if (tool.manager !== 'yarn') commandFail('UNSUPPORTED_MANAGER');
  if (!isYarnGlobalVersion(tool.version)) commandFail('TOOL_VERSION_MISMATCH');
  if (
    !isAbsoluteSafePath(tool.file) ||
    win32.basename(tool.file).toLowerCase() !== 'node.exe' ||
    !tool.entry ||
    !isAbsoluteSafePath(tool.entry) ||
    !/[\\/](?:yarn|cli)\.(?:cjs|mjs|js)$/i.test(tool.entry) ||
    !isAbsoluteSafePath(tool.packageDir) ||
    !key(tool.entry).startsWith(`${key(tool.packageDir)}\\`)
  )
    commandFail('TOOL_LAYOUT_UNSUPPORTED');
}

export async function resolveYarnGlobalTool(
  snapshot: IRunnerToolSnapshot,
  fs: IRunnerFs,
): Promise<IGlobalTool> {
  const { platform, signal } = snapshot;
  signal.throwIfAborted();
  if (platform !== 'win32') throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
  const compare = (value: string) => toComparable(value, 'win32');
  const controlled = (value: string) =>
    snapshot.projectPaths.some(
      (project) =>
        isSameOrInside(compare(value), compare(project), 'win32') ||
        isSameOrInside(compare(project), compare(value), 'win32'),
    );
  const local = (value: string) =>
    isFullyQualifiedPath(value, 'win32') &&
    !value.includes('\0') &&
    !value.includes('\r') &&
    !value.includes('\n') &&
    !/(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/i.test(value) &&
    !controlled(value);
  const regularIdentity = async (
    file: string,
  ): Promise<IRunnerFileIdentity> => {
    if (!local(file)) throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    const observed = runnerIdentity(file, await fs.lstat(file));
    signal.throwIfAborted();
    if (!observed.stat.isFile() || observed.stat.isSymbolicLink())
      throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    const real = await fs.realpath(file);
    signal.throwIfAborted();
    if (compare(real) !== compare(file) || !local(real))
      throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    return observed;
  };
  let node = win32.resolve(snapshot.execPath);
  if (
    !isFullyQualifiedPath(snapshot.execPath, 'win32') ||
    win32.basename(node).toLowerCase() !== 'node.exe'
  )
    throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
  let nodeIdentity: IRunnerFileIdentity;
  try {
    node = win32.resolve(await fs.realpath(node));
    signal.throwIfAborted();
    if (win32.basename(node).toLowerCase() !== 'node.exe')
      throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    nodeIdentity = await regularIdentity(node);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AppException) throw error;
    throw runnerFailure('TOOL_NOT_FOUND');
  }
  const pathValue =
    Object.entries(snapshot.env).find(
      ([envKey]) => envKey.toUpperCase() === 'PATH',
    )?.[1] ?? '';
  const seen = new Set<string>();
  let lastFailure: RunFailureCode = 'TOOL_NOT_FOUND';
  for (const prefix of pathValue.split(';')) {
    signal.throwIfAborted();
    if (
      !isFullyQualifiedPath(prefix, 'win32') ||
      prefix.includes('\0') ||
      prefix.includes('\r') ||
      prefix.includes('\n') ||
      /(?:^|[\\/])node_modules[\\/]\.bin(?:[\\/]|$)/i.test(prefix)
    )
      continue;
    let canonicalPrefix: string;
    try {
      canonicalPrefix = win32.resolve(await fs.realpath(win32.resolve(prefix)));
      signal.throwIfAborted();
      if (!local(canonicalPrefix))
        throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
    } catch (error) {
      signal.throwIfAborted();
      if (isProjectRecord(error) && error.name === 'AbortError') throw error;
      if (!isProjectRecord(error) || error.code !== 'ENOENT')
        lastFailure = 'TOOL_LAYOUT_UNSUPPORTED';
      continue;
    }
    const prefixKey = compare(canonicalPrefix);
    if (seen.has(prefixKey)) continue;
    seen.add(prefixKey);

    const candidates: { root: string; standalone: boolean }[] = [
      {
        root: win32.join(canonicalPrefix, 'node_modules', 'yarn'),
        standalone: false,
      },
    ];
    if (win32.basename(canonicalPrefix).toLowerCase() === 'bin') {
      candidates.push({
        root: win32.resolve(canonicalPrefix, '..'),
        standalone: true,
      });
    }

    for (const candidate of candidates) {
      try {
        const packageDir = win32.resolve(await fs.realpath(candidate.root));
        signal.throwIfAborted();
        if (!local(packageDir)) throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
        const directory = await fs.lstat(packageDir);
        signal.throwIfAborted();
        if (!directory.isDirectory?.() || directory.isSymbolicLink())
          throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
        const metadata = win32.join(packageDir, 'package.json');
        const data = await readRunnerFile(
          metadata,
          1024 * 1024,
          fs,
          signal,
          'win32',
          { optional: true, reason: 'TOOL_LAYOUT_UNSUPPORTED' },
        );
        signal.throwIfAborted();
        if (!data) continue;
        if (!jsonDepthWithinLimit(data.text))
          throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
        const raw: unknown = JSON.parse(data.text);
        if (!isProjectRecord(raw))
          throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
        if (raw.name !== 'yarn') {
          if (candidate.standalone) continue;
          throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
        }
        const binRaw =
          typeof raw.bin === 'string'
            ? raw.bin
            : isProjectRecord(raw.bin)
              ? raw.bin.yarn
              : undefined;
        if (typeof raw.version !== 'string' || typeof binRaw !== 'string')
          throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
        if (!isYarnGlobalVersion(raw.version))
          throw runnerFailure('TOOL_VERSION_MISMATCH');
        if (isProjectRecord(raw.engines) && raw.engines.node !== undefined) {
          const nodeRange = raw.engines.node;
          if (
            typeof nodeRange !== 'string' ||
            nodeRange.trim().length === 0 ||
            semver.validRange(nodeRange) === null
          )
            throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
          const nodeVersion = snapshot.nodeVersion ?? process.versions.node;
          if (
            !semver.valid(nodeVersion) ||
            !semver.satisfies(nodeVersion, nodeRange)
          )
            throw runnerFailure('TOOL_VERSION_MISMATCH');
        }
        const entryPath = win32.resolve(packageDir, binRaw);
        if (
          win32.isAbsolute(binRaw) ||
          /^[A-Za-z]:/.test(binRaw) ||
          !isSameOrInside(compare(entryPath), compare(packageDir), 'win32') ||
          !/[\\/](?:yarn|cli)\.(?:cjs|mjs|js)$/i.test(entryPath)
        )
          throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
        const entry = win32.resolve(await fs.realpath(entryPath));
        signal.throwIfAborted();
        if (
          !local(entry) ||
          !isSameOrInside(compare(entry), compare(packageDir), 'win32') ||
          !/[\\/](?:yarn|cli)\.(?:cjs|mjs|js)$/i.test(entry)
        )
          throw runnerFailure('TOOL_LAYOUT_UNSUPPORTED');
        const entryIdentity = await regularIdentity(entry);
        signal.throwIfAborted();
        return {
          manager: 'yarn',
          version: raw.version,
          file: node,
          entry,
          packageDir,
          identities: [
            nodeIdentity,
            data.identity,
            entryIdentity,
            runnerIdentity(packageDir, directory),
          ],
        };
      } catch (error) {
        signal.throwIfAborted();
        if (isProjectRecord(error) && error.name === 'AbortError') throw error;
        if (error instanceof AppException) {
          const details: unknown = isProjectRecord(error)
            ? error.details
            : undefined;
          const reason = isProjectRecord(details) ? details.reason : undefined;
          if (reason === 'INPUT_CHANGED') throw error;
          lastFailure =
            reason === 'TOOL_VERSION_MISMATCH'
              ? reason
              : 'TOOL_LAYOUT_UNSUPPORTED';
        } else if (!isProjectRecord(error) || error.code !== 'ENOENT') {
          lastFailure = 'TOOL_LAYOUT_UNSUPPORTED';
        }
      }
    }
  }
  throw runnerFailure(lastFailure);
}

function buildYarnChildEnv(
  snapshot: Readonly<NodeJS.ProcessEnv>,
  config: IYarnGlobalConfig,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  const seen = new Set<string>();
  for (const [envKey, value] of Object.entries(snapshot)) {
    const upper = envKey.toUpperCase();
    if (
      seen.has(upper) ||
      value === undefined ||
      YARN_UNSAFE_CHILD_ENV.has(upper) ||
      upper.startsWith('PKGSTEWARD_') ||
      upper.startsWith('NODE_CHANNEL_') ||
      upper.startsWith('NPM_') ||
      upper.startsWith('PNPM_') ||
      upper.startsWith('YARN_') ||
      ['__PROTO__', 'CONSTRUCTOR', 'PROTOTYPE'].includes(upper)
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
    } else {
      env[upper === 'CI' ? 'CI' : envKey] = value;
    }
  }
  const forced: Record<string, string> = {
    NoDefaultCurrentDirectoryInExePath: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    COREPACK_ENABLE_NETWORK: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    YARN_IGNORE_PATH: '1',
    YARN_ENABLE_TELEMETRY: '0',
    NO_UPDATE_NOTIFIER: '1',
    CI: '1',
    PREFIX: config.prefixDir,
    YARN_CACHE_FOLDER: config.cacheDir,
  };
  for (const [forcedKey, forcedValue] of Object.entries(forced)) {
    for (const existing of Object.keys(env)) {
      if (existing.toLowerCase() === forcedKey.toLowerCase())
        delete env[existing];
    }
    env[forcedKey] = forcedValue;
  }
  return env;
}

export function buildYarnGlobalCommand(
  input: IYarnMutationInput,
  config: IYarnGlobalConfig,
): IGlobalCommand {
  const { location, action, packageName, exactVersion } = input;
  const { tool, cwd } = location;
  if (location.manager !== 'yarn') commandFail('UNSUPPORTED_MANAGER');
  assertYarnLauncher(tool);
  if (!isAbsoluteSafePath(cwd)) commandFail('CONFIG_UNSUPPORTED');
  const validExactVersion =
    typeof exactVersion === 'string' &&
    !!semver.parse(exactVersion) &&
    exactVersion ===
      semver.parse(exactVersion)!.version +
        (semver.parse(exactVersion)!.build.length
          ? `+${semver.parse(exactVersion)!.build.join('.')}`
          : '');
  if (
    !isGlobalPackageName(packageName) ||
    (action === 'change' ? !validExactVersion : exactVersion !== null)
  )
    commandFail('INVALID_PACKAGE_SPEC');
  if (
    action === 'change' &&
    (!input.publicRegistry ||
      config.policy.changeUnsupported ||
      config.policy.unknownRouting)
  )
    commandFail('REGISTRY_CONFIG_UNSUPPORTED');
  const requiredPaths = [
    config.prefixDir,
    config.globalDir,
    config.globalRoot,
    config.binDir,
    config.cacheDir,
    config.mutexFile,
  ];
  if (requiredPaths.some((value) => !value || !isAbsoluteSafePath(value)))
    commandFail('LOCATION_AMBIGUOUS');
  for (const [actual, pinned] of [
    [location.prefix, config.prefixDir],
    [location.globalDir, config.globalDir],
    [location.globalRoot, config.globalRoot],
    [location.binDir, config.binDir],
    [location.cacheDir, config.cacheDir],
  ]) {
    if (!actual || !pinned || key(actual) !== key(pinned))
      commandFail('LOCATION_AMBIGUOUS');
  }
  const args = [
    tool.entry!,
    'global',
    action === 'change' ? 'add' : 'remove',
    '--global-folder',
    config.globalDir,
    '--prefix',
    config.prefixDir,
    '--cache-folder',
    config.cacheDir,
    '--mutex',
    `file:${config.mutexFile}`,
    '--non-interactive',
    ...(action === 'change' ? ['--registry', PUBLIC_REGISTRY] : []),
    '--',
    action === 'change' ? `${packageName}@${exactVersion}` : packageName,
  ];
  return {
    file: tool.file,
    cwd,
    args,
    env: buildYarnChildEnv(input.environment, config),
    shell: false,
    extendEnv: false,
    stdin: 'ignore',
  };
}
