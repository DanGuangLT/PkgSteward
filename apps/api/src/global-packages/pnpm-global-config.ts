import type {
  IPnpmGlobalConfig,
  IPnpmGlobalConfigDeps,
  IPnpmGlobalPolicy,
  IPnpmGlobalSafetySettings,
  PnpmGlobalSelector,
} from '@/global-packages/interfaces/pnpm-global.types';
import type {
  IGlobalRegistryDecision,
  IGlobalRegistryInput,
  IGlobalConfigIdentity,
} from '@/global-packages/interfaces/global-packages.runtime';
import type { IRunnerFileIdentity } from '@/npm-runner/interfaces/npm-runner.types';
import { AppException } from '@/common/exceptions/app.exception';
import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import {
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
} from '@/global-packages/global-config';
import { isGlobalAbsolutePath } from '@/global-packages/global-command';
import { isGlobalPackageName } from '@/global-packages/global-policy';
import { runnerIdentity, sameRunnerIdentity } from '@/npm-runner/runner-tool';

type ConfigReason =
  'CONFIG_UNSUPPORTED' | 'LIMIT_EXCEEDED' | 'PNPM_GLOBAL_NOT_CONFIGURED';
const refuse = (reason: ConfigReason): never => {
  throw new AppException(
    409,
    'pnpm global configuration is unavailable',
    'CONFLICT',
    { reason },
  );
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const missing = (error: unknown): boolean =>
  record(error) && error.code === 'ENOENT';
const comparable = (path: string): string => win32.resolve(path).toLowerCase();
const dynamic = (value: string): boolean =>
  value.includes('${') ||
  value.includes('$(') ||
  value.includes('`') ||
  Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const normalizedKey = (key: string): string =>
  key.replace(/[-_]/g, '').toLowerCase();
const pathValue = (value: unknown, preserveStoreSyntax = false): string => {
  if (typeof value !== 'string' || !isGlobalAbsolutePath(value))
    return refuse('CONFIG_UNSUPPORTED');
  return preserveStoreSyntax ? value : win32.normalize(value);
};
const publicRegistry = (value: unknown): boolean =>
  value === 'https://registry.npmjs.org' ||
  value === 'https://registry.npmjs.org/';

const SELECTORS = [
  'PNPM_HOME',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'LOCALAPPDATA',
  'APPDATA',
  'USERPROFILE',
  'HOME',
  'pnpm_config_npmrc_auth_file',
  'pnpm_config_userconfig',
  'pnpm_config_global_dir',
  'pnpm_config_global_bin_dir',
  'pnpm_config_store_dir',
  'pnpm_config_cache_dir',
  'pnpm_config_state_dir',
  'pnpm_config_config_dir',
  'pnpm_config_pnpm_home_dir',
  'npm_config_userconfig',
] as const satisfies readonly PnpmGlobalSelector[];

type PathSetting =
  | 'globaldir'
  | 'globalbindir'
  | 'storedir'
  | 'cachedir'
  | 'statedir'
  | 'npmrcauthfile';
interface IParsedSource {
  policy: IPnpmGlobalPolicy;
  paths: Partial<Record<PathSetting, string>>;
  safety: IPnpmGlobalSafetySettings;
  executable: boolean;
}
const emptySource = (): IParsedSource => ({
  policy: {
    defaultRegistry: null,
    scopedRegistries: [],
    unknownRouting: false,
    publicAuthPresent: false,
    changeUnsupported: false,
  },
  paths: {},
  safety: {},
  executable: false,
});
const addScope = (policy: IPnpmGlobalPolicy, scope: string): void => {
  if (!isGlobalPackageName(`${scope}/test-package`))
    policy.unknownRouting = true;
  else
    policy.scopedRegistries = [
      ...new Set([...policy.scopedRegistries, scope]),
    ].sort();
};
const mergePolicy = (
  target: IPnpmGlobalPolicy,
  source: IPnpmGlobalPolicy,
): void => {
  if (
    source.defaultRegistry === 'custom' ||
    target.defaultRegistry === 'custom'
  )
    target.defaultRegistry = 'custom';
  else target.defaultRegistry ??= source.defaultRegistry;
  target.scopedRegistries = [
    ...new Set([...target.scopedRegistries, ...source.scopedRegistries]),
  ].sort();
  target.unknownRouting ||= source.unknownRouting;
  target.changeUnsupported ||= source.changeUnsupported;
  target.publicAuthPresent ||= source.publicAuthPresent;
};

function inspectJsonAuth(value: unknown, policy: IPnpmGlobalPolicy): void {
  if (!record(value)) {
    policy.unknownRouting = true;
    return;
  }
  for (const [url, scopes] of Object.entries(value)) {
    let valid = !dynamic(url);
    try {
      const parsed = new URL(url);
      valid &&=
        ['https:', 'http:'].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash;
    } catch {
      valid = false;
    }
    if (!valid || !record(scopes)) {
      policy.unknownRouting = true;
      continue;
    }
    for (const [scope, credentials] of Object.entries(scopes)) {
      if (
        !record(credentials) ||
        typeof credentials.authToken !== 'string' ||
        Object.keys(credentials).some((key) => key !== 'authToken')
      ) {
        policy.unknownRouting = true;
        continue;
      }
      if (publicRegistry(url)) policy.publicAuthPresent = true;
      if (scope === '@') {
        if (!publicRegistry(url)) policy.defaultRegistry = 'custom';
        else policy.defaultRegistry ??= 'public';
      } else addScope(policy, scope);
    }
  }
}

function inspectRoutingMap(
  value: unknown,
  policy: IPnpmGlobalPolicy,
  scopesKnown: boolean,
): void {
  if (!record(value)) {
    policy.unknownRouting = true;
    return;
  }
  // pnpm 11.22.0:167190-167203 expands map values;168789-168811 unions routes.
  for (const [scope, destination] of Object.entries(value)) {
    if (
      dynamic(scope) ||
      typeof destination !== 'string' ||
      dynamic(destination)
    ) {
      policy.unknownRouting = true;
      continue;
    }
    try {
      const url = new URL(destination);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        policy.unknownRouting = true;
        continue;
      }
    } catch {
      policy.unknownRouting = true;
      continue;
    }
    if (scope === 'default') {
      if (!publicRegistry(destination)) policy.defaultRegistry = 'custom';
      else policy.defaultRegistry ??= 'public';
    } else if (scopesKnown && scope.startsWith('@')) addScope(policy, scope);
    else if (scopesKnown || !publicRegistry(destination))
      policy.unknownRouting = true;
  }
}

const executableKeys = new Set([
  'pnpmfile',
  'globalpnpmfile',
  'onloadscript',
  'yarnpath',
  'nodeoptions',
  'configdependencies',
  'include',
  'includes',
  'hooks',
  'managepackagemanagerversions',
]);
const unsupportedSettings = new Set([
  'ignorescripts',
  'ignoredepscripts',
  'dangerouslyallowallbuilds',
  'onlybuiltdependencies',
  'onlybuiltdependenciesfile',
  'neverbuiltdependencies',
  'ignoredbuiltdependencies',
  'nodelinker',
  'symlink',
  'enableglobalvirtualstore',
  'virtualstoredir',
  'virtualstoredirmaxlength',
  'hoist',
  'hoistpattern',
  'publichoistpattern',
  'shamefullyhoist',
  'injectworkspacepackages',
  'packageimportmethod',
  'patcheddependencies',
]);
const pathSettings = new Set<PathSetting>([
  'globaldir',
  'globalbindir',
  'storedir',
  'cachedir',
  'statedir',
  'npmrcauthfile',
]);
const yamlPathKeys: Record<PathSetting, string> = {
  globaldir: 'globalDir',
  globalbindir: 'globalBinDir',
  storedir: 'storeDir',
  cachedir: 'cacheDir',
  statedir: 'stateDir',
  npmrcauthfile: 'npmrcAuthFile',
};
const yamlSafetyKeys: Readonly<Record<string, string>> = {
  minimumreleaseage: 'minimumReleaseAge',
  minimumreleaseagestrict: 'minimumReleaseAgeStrict',
  allowbuilds: 'allowBuilds',
};

function inspectSetting(
  source: IParsedSource,
  key: string,
  value: unknown,
): void {
  const lower = key.toLowerCase();
  const normalized = normalizedKey(key);
  if (normalized.endsWith(':tokenhelper') || executableKeys.has(normalized)) {
    source.executable = true;
    source.policy.changeUnsupported = true;
    return;
  }
  // Values belonging to auth keys are never included in policy or path facts.
  if (
    /^\/\/[^/]+\/.*:(?:_authtoken|_auth|_password|username|email|always-auth)$/i.test(
      key,
    )
  ) {
    if (lower.startsWith('//registry.npmjs.org/:'))
      source.policy.publicAuthPresent = true;
    return;
  }
  if (lower === '_auth') {
    inspectJsonAuth(value, source.policy);
    return;
  }
  if (['_authtoken', '_password', 'username', 'email'].includes(lower)) {
    source.policy.publicAuthPresent = true;
    return;
  }
  if (dynamic(key)) {
    source.policy.unknownRouting = true;
    return;
  }
  if (
    ['registries', 'namedregistries', 'packagemanagerregistries'].includes(
      normalized,
    )
  ) {
    inspectRoutingMap(value, source.policy, normalized === 'registries');
    return;
  }
  if (lower === 'registry') {
    if (typeof value !== 'string' || !value || dynamic(value))
      source.policy.unknownRouting = true;
    else if (!publicRegistry(value)) source.policy.defaultRegistry = 'custom';
    else source.policy.defaultRegistry ??= 'public';
    return;
  }
  const scoped = /^(@[^:]+):registry$/.exec(lower);
  if (scoped) {
    addScope(source.policy, scoped[1]);
    if (typeof value !== 'string' || !value || dynamic(value))
      source.policy.unknownRouting = true;
    return;
  }
  if (pathSettings.has(normalized as PathSetting)) {
    const setting = normalized as PathSetting;
    const path = pathValue(value, setting === 'storedir');
    if (
      source.paths[setting] &&
      comparable(source.paths[setting]) !== comparable(path)
    )
      return refuse('CONFIG_UNSUPPORTED');
    source.paths[setting] = path;
    return;
  }
  if (
    [
      'configdir',
      'pnpmhomedir',
      'userconfig',
      'globalconfig',
      'prefix',
    ].includes(normalized)
  )
    return refuse('CONFIG_UNSUPPORTED');
  if (normalized === 'minimumreleaseage') {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      source.safety.minimumReleaseAge = value;
    else source.policy.changeUnsupported = true;
    return;
  }
  if (normalized === 'minimumreleaseagestrict') {
    if (typeof value === 'boolean')
      source.safety.minimumReleaseAgeStrict = value;
    else source.policy.changeUnsupported = true;
    return;
  }
  if (normalized === 'allowbuilds') {
    if (
      record(value) &&
      Object.entries(value).every(
        ([name, allowed]) =>
          isGlobalPackageName(name) && typeof allowed === 'boolean',
      )
    )
      source.safety.allowBuilds = Object.fromEntries(
        Object.entries(value),
      ) as Record<string, boolean>;
    else source.policy.changeUnsupported = true;
    return;
  }
  if (
    unsupportedSettings.has(normalized) ||
    normalized.startsWith('minimumreleaseage')
  )
    source.policy.changeUnsupported = true;
  else if (normalized.includes('registr')) source.policy.unknownRouting = true;
}

function parseYaml(text: string): Record<string, unknown> {
  const doc = parseDocument(text, { uniqueKeys: true, merge: false });
  if (doc.errors.length || doc.warnings.length)
    return refuse('CONFIG_UNSUPPORTED');
  const inspect = (node: unknown, depth: number): void => {
    if (depth > 64 || isAlias(node)) return refuse('CONFIG_UNSUPPORTED');
    if (isMap(node) || isSeq(node) || isScalar(node)) {
      if (node.tag || node.anchor) return refuse('CONFIG_UNSUPPORTED');
      if (isMap(node))
        for (const pair of node.items) {
          if (
            !isScalar(pair.key) ||
            typeof pair.key.value !== 'string' ||
            ['__proto__', 'constructor', 'prototype', '<<'].includes(
              pair.key.value,
            )
          )
            return refuse('CONFIG_UNSUPPORTED');
          inspect(pair.key, depth + 1);
          inspect(pair.value, depth + 1);
        }
      else if (isSeq(node))
        for (const child of node.items) inspect(child, depth + 1);
    }
  };
  inspect(doc.contents, 0);
  const result: unknown = doc.toJS({ maxAliasCount: 0 });
  if (result === null) return {};
  if (!record(result)) return refuse('CONFIG_UNSUPPORTED');
  return result;
}

function parseSource(text: string, format?: 'yaml' | 'ini'): IParsedSource {
  if (Buffer.byteLength(text, 'utf8') > GLOBAL_CONFIG_FILE_LIMIT)
    return refuse('LIMIT_EXCEEDED');
  const result = emptySource();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'));
  const ini =
    format === 'ini' ||
    (format === undefined &&
      lines.some((line) => line.includes('=')) &&
      !lines.some((line) => /:\s|:$/.test(line)));
  if (!ini) {
    for (const [key, value] of Object.entries(parseYaml(text))) {
      // pnpm 11.22.0:168608-168628 drops non-camelCase global YAML keys.
      // Reject path aliases rather than previewing a path pnpm will ignore.
      const normalized = normalizedKey(key) as PathSetting;
      if (pathSettings.has(normalized) && key !== yamlPathKeys[normalized])
        return refuse('CONFIG_UNSUPPORTED');
      const safetyKey = yamlSafetyKeys[normalized];
      if (safetyKey && key !== safetyKey) {
        result.policy.changeUnsupported = true;
        continue;
      }
      inspectSetting(result, key, value);
    }
    return result;
  }
  for (const line of lines) {
    const split = line.indexOf('=');
    if (split <= 0) {
      result.policy.unknownRouting = true;
      continue;
    }
    const key = line.slice(0, split).trim();
    const value = line.slice(split + 1).trim();
    if (key.toLowerCase() === '_auth') {
      result.policy.publicAuthPresent = true;
      continue;
    }
    inspectSetting(result, key, value);
  }
  return result;
}

function environmentBytes(environment: Readonly<NodeJS.ProcessEnv>): number {
  let size = 0;
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    size += Buffer.byteLength(key) + Buffer.byteLength(value);
    if (size > GLOBAL_CONFIG_TOTAL_LIMIT) return refuse('LIMIT_EXCEEDED');
  }
  return size;
}

function parseEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
): IParsedSource {
  const source = emptySource();
  const seen = new Map<string, string>();
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'npm_token' || lower === 'node_auth_token') {
      source.policy.publicAuthPresent = true;
      continue;
    }
    if (!/^(?:pnpm|npm)_config_/.test(lower)) continue;
    const setting = lower.replace(/^(?:pnpm|npm)_config_/, '');
    // Directory selectors are validated separately; never reinterpret them as YAML.
    if (SELECTORS.some((selector) => selector.toLowerCase() === lower))
      continue;
    const normalized = normalizedKey(setting);
    if (Object.hasOwn(yamlSafetyKeys, normalized)) {
      // pnpm 11.22.0:166500-166503,168242-168245: allow-builds has no env
      // schema. Do not claim env policy; never silently discard a requested
      // safety constraint either. Changes require statically consumed YAML.
      source.policy.changeUnsupported = true;
      continue;
    }
    if (
      setting === '_auth' ||
      normalized.includes('registry') ||
      normalized.endsWith(':tokenhelper') ||
      executableKeys.has(normalized) ||
      unsupportedSettings.has(normalized) ||
      ['minimumreleaseage', 'minimumreleaseagestrict', 'allowbuilds'].includes(
        normalized,
      )
    ) {
      const fingerprint = createHash('sha256').update(value).digest('hex');
      if (seen.has(lower) && seen.get(lower) !== fingerprint)
        source.policy.unknownRouting = true;
      seen.set(lower, fingerprint);
    }
    if (setting === '_auth') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value) as unknown;
      } catch {
        source.policy.unknownRouting = true;
        continue;
      }
      inspectSetting(source, setting, parsed);
    } else inspectSetting(source, setting, value);
  }
  return source;
}

interface IReadState {
  remaining: number;
  identities: IGlobalConfigIdentity[];
  absent: string[];
}

async function readSource(
  path: string,
  format: 'yaml' | 'ini',
  deps: IPnpmGlobalConfigDeps,
  state: IReadState,
): Promise<IParsedSource> {
  const { fs, signal } = deps;
  signal.throwIfAborted();
  await deps.checkDirectory(win32.dirname(path));
  signal.throwIfAborted();
  try {
    let identity: IRunnerFileIdentity;
    try {
      identity = runnerIdentity(path, await fs.lstat(path));
    } catch (error) {
      signal.throwIfAborted();
      if (missing(error)) {
        state.absent.push(path);
        return emptySource();
      }
      throw error;
    }
    signal.throwIfAborted();
    if (!identity.stat.isFile() || identity.stat.isSymbolicLink())
      return refuse('CONFIG_UNSUPPORTED');
    if (!Number.isSafeInteger(identity.stat.size) || identity.stat.size < 0)
      return refuse('CONFIG_UNSUPPORTED');
    if (
      identity.stat.size > GLOBAL_CONFIG_FILE_LIMIT ||
      identity.stat.size > state.remaining
    )
      return refuse('LIMIT_EXCEEDED');
    if (comparable(await fs.realpath(path)) !== comparable(path))
      return refuse('CONFIG_UNSUPPORTED');
    signal.throwIfAborted();
    const handle = await fs.open(path);
    try {
      signal.throwIfAborted();
      if (!sameRunnerIdentity(identity.stat, await handle.stat()))
        return refuse('CONFIG_UNSUPPORTED');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const bytes of handle.readChunks(signal)) {
        signal.throwIfAborted();
        size += bytes.byteLength;
        state.remaining -= bytes.byteLength;
        if (size > GLOBAL_CONFIG_FILE_LIMIT || state.remaining < 0)
          return refuse('LIMIT_EXCEEDED');
        chunks.push(Buffer.from(bytes));
      }
      signal.throwIfAborted();
      const afterHandle = await handle.stat();
      const after = await fs.lstat(path);
      const real = await fs.realpath(path);
      signal.throwIfAborted();
      await deps.checkDirectory(win32.dirname(path));
      signal.throwIfAborted();
      if (
        size !== identity.stat.size ||
        !sameRunnerIdentity(identity.stat, afterHandle) ||
        !sameRunnerIdentity(identity.stat, after) ||
        comparable(real) !== comparable(path)
      )
        return refuse('CONFIG_UNSUPPORTED');
      const bytes = Buffer.concat(chunks, size);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed = parseSource(text, format);
      state.identities.push({
        file: identity,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      return parsed;
    } finally {
      await handle.close();
      signal.throwIfAborted();
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AppException) throw error;
    return refuse('CONFIG_UNSUPPORTED');
  }
}

export async function readPnpmGlobalConfig(
  deps: IPnpmGlobalConfigDeps,
): Promise<IPnpmGlobalConfig> {
  deps.signal.throwIfAborted();
  const state: IReadState = {
    remaining: GLOBAL_CONFIG_TOTAL_LIMIT - environmentBytes(deps.environment),
    identities: [],
    absent: [],
  };
  const selectors: Partial<Record<PnpmGlobalSelector, string>> = {};
  let path: string | undefined;
  for (const [key, value] of Object.entries(deps.environment)) {
    if (value === undefined) continue;
    if (key.toLowerCase() === 'path') {
      if (path !== undefined && path !== value)
        return refuse('CONFIG_UNSUPPORTED');
      path = value;
    }
    const canonical = SELECTORS.find(
      (selector) => selector.toLowerCase() === key.toLowerCase(),
    );
    if (!canonical) continue;
    const normalized = pathValue(value, canonical === 'pnpm_config_store_dir');
    if (
      selectors[canonical] !== undefined &&
      comparable(selectors[canonical]) !== comparable(normalized)
    )
      return refuse('CONFIG_UNSUPPORTED');
    selectors[canonical] = normalized;
  }
  const profile = selectors.USERPROFILE ?? selectors.HOME;
  if (!profile) return refuse('CONFIG_UNSUPPORTED');
  const local = selectors.LOCALAPPDATA;
  // pnpm 11.22.0 dirs.js (bundle 166449-166480): H and D are independent.
  const homeDir =
    selectors.PNPM_HOME ??
    (selectors.XDG_DATA_HOME
      ? win32.join(selectors.XDG_DATA_HOME, 'pnpm')
      : local
        ? win32.join(local, 'pnpm')
        : win32.join(profile, '.pnpm'));
  const configDir = selectors.XDG_CONFIG_HOME
    ? win32.join(selectors.XDG_CONFIG_HOME, 'pnpm')
    : local
      ? win32.join(local, 'pnpm', 'config')
      : win32.join(profile, '.config', 'pnpm');
  const main = await readSource(
    win32.join(configDir, 'config.yaml'),
    'yaml',
    deps,
    state,
  );
  const globalDir = main.paths.globaldir ?? win32.join(homeDir, 'global');
  const globalRoot = win32.join(globalDir, 'v11');
  const binDir = main.paths.globalbindir ?? win32.join(homeDir, 'bin');
  const storeBase = main.paths.storedir ?? selectors.pnpm_config_store_dir;
  // pathAbsolute returns an already absolute path unchanged (166015-166016).
  const absoluteStore = storeBase;
  // pnpm 11.22.0:182655-182659 checks the exact suffix after pathAbsolute.
  const storeDir = absoluteStore
    ? absoluteStore.endsWith(`${win32.sep}v11`)
      ? absoluteStore
      : win32.join(absoluteStore, 'v11')
    : null;
  const cacheDir =
    main.paths.cachedir ??
    selectors.pnpm_config_cache_dir ??
    (selectors.XDG_CACHE_HOME
      ? win32.join(selectors.XDG_CACHE_HOME, 'pnpm')
      : local
        ? win32.join(local, 'pnpm-cache')
        : win32.join(profile, '.pnpm-cache'));
  const stateDir =
    main.paths.statedir ??
    selectors.pnpm_config_state_dir ??
    (selectors.XDG_STATE_HOME
      ? win32.join(selectors.XDG_STATE_HOME, 'pnpm')
      : local
        ? win32.join(local, 'pnpm-state')
        : win32.join(profile, '.pnpm-state'));
  const authFile =
    selectors.pnpm_config_npmrc_auth_file ??
    selectors.pnpm_config_userconfig ??
    main.paths.npmrcauthfile ??
    selectors.npm_config_userconfig ??
    win32.join(profile, '.npmrc');
  for (const [selector, effective] of [
    [selectors.pnpm_config_global_dir, globalDir],
    [selectors.pnpm_config_global_bin_dir, binDir],
    [selectors.pnpm_config_config_dir, configDir],
    [selectors.pnpm_config_pnpm_home_dir, homeDir],
  ])
    if (selector && effective && comparable(selector) !== comparable(effective))
      return refuse('CONFIG_UNSUPPORTED');
  const originalPath = (path ?? '')
    .split(';')
    .filter((entry) => isGlobalAbsolutePath(entry));
  if (!originalPath.some((entry) => comparable(entry) === comparable(binDir)))
    return refuse('PNPM_GLOBAL_NOT_CONFIGURED');
  const directoryIdentities: IRunnerFileIdentity[] = [];
  const missingDirectoryPaths: string[] = [];
  for (const directory of [
    ...new Set([
      binDir,
      homeDir,
      globalDir,
      globalRoot,
      configDir,
      cacheDir,
      stateDir,
      deps.cwd,
      ...(storeDir ? [storeDir] : []),
    ]),
  ]) {
    await deps.checkDirectory(directory);
    deps.signal.throwIfAborted();
    try {
      const stat = await deps.fs.lstat(directory);
      deps.signal.throwIfAborted();
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory?.() ||
        comparable(await deps.fs.realpath(directory)) !== comparable(directory)
      )
        return refuse('CONFIG_UNSUPPORTED');
      directoryIdentities.push(runnerIdentity(directory, stat));
    } catch (error) {
      deps.signal.throwIfAborted();
      if (!missing(error)) {
        if (error instanceof AppException) throw error;
        return refuse('CONFIG_UNSUPPORTED');
      }
      if (comparable(directory) === comparable(binDir))
        return refuse('PNPM_GLOBAL_NOT_CONFIGURED');
      missingDirectoryPaths.push(directory);
    }
  }
  const policy = emptySource().policy;
  // pnpm 11.22.0:168516-168517,168867-168868: age default and global GVS build map.
  // Global YAML then R/pnpm-workspace.yaml are consumed at168608-168640,168774-168785.
  const safety: IPnpmGlobalSafetySettings = {
    minimumReleaseAge: 1440,
    allowBuilds: {},
    ...main.safety,
  };
  let releaseAgeExplicit = main.safety.minimumReleaseAge !== undefined;
  const sources = [main];
  const sourcePaths: [string, 'yaml' | 'ini'][] = [
    [authFile, 'ini'],
    [win32.join(configDir, 'auth.ini'), 'ini'],
    [win32.join(deps.cwd, '.npmrc'), 'ini'],
    [win32.join(deps.tool.packageDir, 'dist', 'pnpmrc'), 'ini'],
    [win32.join(globalRoot, 'pnpm-workspace.yaml'), 'yaml'],
  ];
  const read = new Map<string, 'yaml' | 'ini'>([
    [comparable(win32.join(configDir, 'config.yaml')), 'yaml'],
  ]);
  for (const [file, format] of sourcePaths) {
    const previousFormat = read.get(comparable(file));
    if (previousFormat) {
      if (previousFormat !== format) return refuse('CONFIG_UNSUPPORTED');
      continue;
    }
    read.set(comparable(file), format);
    const source = await readSource(file, format, deps, state);
    if (format === 'yaml') {
      Object.assign(safety, source.safety);
      releaseAgeExplicit ||= source.safety.minimumReleaseAge !== undefined;
    }
    const expectedPaths: Partial<Record<PathSetting, string>> = {
      globaldir: globalDir,
      globalbindir: binDir,
      storedir: storeBase,
      cachedir: cacheDir,
      statedir: stateDir,
      npmrcauthfile: authFile,
    };
    for (const key of pathSettings) {
      const value = source.paths[key];
      if (value === undefined) continue;
      const expected = expectedPaths[key];
      if (!expected || comparable(expected) !== comparable(value))
        return refuse('CONFIG_UNSUPPORTED');
    }
    sources.push(source);
  }
  sources.push(parseEnvironment(deps.environment));
  for (const source of sources) {
    if (source.executable) return refuse('CONFIG_UNSUPPORTED');
    mergePolicy(policy, source.policy);
  }
  // pnpm 11.22.0:168836-168838 makes an explicit age strict unless explicitly set otherwise.
  if (releaseAgeExplicit && safety.minimumReleaseAgeStrict === undefined)
    safety.minimumReleaseAgeStrict = true;
  deps.signal.throwIfAborted();
  return {
    homeDir,
    globalDir,
    globalRoot,
    binDir,
    storeDir,
    cacheDir,
    stateDir,
    configDir,
    authFile,
    originalPath,
    configIdentities: state.identities,
    missingConfigPaths: state.absent,
    missingDirectoryPaths,
    directoryIdentities,
    selectors,
    policy,
    safety,
  };
}

export function assessPnpmGlobalRegistryPolicy(
  input: IGlobalRegistryInput,
): IGlobalRegistryDecision {
  let bytes = environmentBytes(input.environment);
  for (const text of input.configs) {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > GLOBAL_CONFIG_TOTAL_LIMIT) return refuse('LIMIT_EXCEEDED');
  }
  const policy = emptySource().policy;
  for (const text of input.configs) {
    try {
      mergePolicy(policy, parseSource(text).policy);
    } catch (error) {
      if (
        error instanceof AppException &&
        record(error.details) &&
        error.details.reason === 'LIMIT_EXCEEDED'
      )
        throw error;
      policy.unknownRouting = true;
    }
  }
  mergePolicy(policy, parseEnvironment(input.environment).policy);
  for (const source of input.pnpmPolicies ?? []) mergePolicy(policy, source);
  const scope = input.packageName.startsWith('@')
    ? input.packageName.split('/')[0]
    : null;
  const unsupported =
    !input.provenanceKnown ||
    !isGlobalPackageName(input.packageName) ||
    policy.unknownRouting ||
    policy.changeUnsupported ||
    policy.defaultRegistry === 'custom' ||
    (scope !== null && policy.scopedRegistries.includes(scope));
  return {
    changeAllowed: !unsupported,
    reason:
      input.action === 'change' && unsupported
        ? 'REGISTRY_CONFIG_UNSUPPORTED'
        : null,
    publicAuthPresent: policy.publicAuthPresent,
  };
}
