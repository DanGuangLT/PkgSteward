import { createHash } from 'node:crypto';
import { win32 } from 'node:path';
import { AppException } from '@/common/exceptions/app.exception';
import {
  GLOBAL_CONFIG_FILE_LIMIT,
  GLOBAL_CONFIG_TOTAL_LIMIT,
} from '@/global-packages/config/global-config';
import { readPnpm10File } from '@/global-packages/config/pnpm10-global-config';
import { isGlobalAbsolutePath } from '@/global-packages/execution/global-command';
import type {
  IGlobalConfigIdentity,
  IGlobalTool,
} from '@/global-packages/interfaces/global-packages.runtime';
import type { IPnpmGlobalPolicy } from '@/global-packages/interfaces/pnpm-global.types';
import type { IYarnGlobalConfig } from '@/global-packages/interfaces/yarn-global.types';
import { isGlobalPackageName } from '@/global-packages/policy/global-policy';
import type {
  IRunnerFileIdentity,
  IRunnerFs,
} from '@/npm-runner/interfaces/npm-runner.types';
import {
  runnerIdentity,
  sameRunnerIdentity,
} from '@/npm-runner/toolchain/runner-tool';

type YarnConfigReason =
  'CONFIG_UNSUPPORTED' | 'LIMIT_EXCEEDED' | 'LOCATION_AMBIGUOUS';

export interface IYarnGlobalConfigDeps {
  fs: IRunnerFs;
  signal: AbortSignal;
  tool: IGlobalTool;
  cwd: string;
  dataDir: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  checkDirectory(path: string): Promise<void>;
}

const refuse = (reason: YarnConfigReason = 'CONFIG_UNSUPPORTED'): never => {
  throw new AppException(409, 'Yarn configuration is unavailable', 'CONFLICT', {
    reason,
  });
};

const key = (p: string): string => win32.resolve(p).toLowerCase();
const inside = (path: string, parent: string): boolean =>
  key(path) === key(parent) || key(path).startsWith(`${key(parent)}\\`);
const overlaps = (a: string, b: string): boolean =>
  inside(a, b) || inside(b, a);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const absent = (e: unknown): boolean => record(e) && e.code === 'ENOENT';
const canonical = (s: string): string => s.replace(/[-_]/g, '').toLowerCase();
const dynamic = (v: string): boolean =>
  /\$\{|\$\(|`/.test(v) ||
  Array.from(v).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

const absolute = (v: unknown): string => {
  if (typeof v !== 'string' || !isGlobalAbsolutePath(v) || dynamic(v))
    return refuse();
  return win32.normalize(v);
};

const PUBLIC_YARN_REGISTRIES = new Set([
  'https://registry.npmjs.org',
  'https://registry.npmjs.org/',
  'https://registry.yarnpkg.com',
  'https://registry.yarnpkg.com/',
]);

const PATH_OPTIONS = new Set(['prefix', 'globalfolder', 'cachefolder']);
const SHARED_NPMRC_PATH_OPTIONS = new Set([
  'storedir',
  'globaldir',
  'globalbindir',
  'cachedir',
  'statedir',
  'configdir',
  'cache',
  'modulesdir',
  'virtualstoredir',
  'userconfig',
  'globalconfig',
]);
const CHANGE_UNSUPPORTED_OPTIONS =
  /(?:yarnpath|onloadscript|scriptshell|pnpmfile|nodeoptions|plugin|hooks|ignorescripts|networkoffline|offlinemirror|cafile|httpsproxy|proxy|resolutions)/;
const UNPROVEN_PATH_OPTIONS =
  /(?:dir|dirs|directory|directories|path|paths|file|files|folder|folders)$|userconfig|globalconfig/;

interface IYarnSettings {
  paths: Map<string, string>;
  policy: IPnpmGlobalPolicy;
}

const emptySettings = (): IYarnSettings => ({
  paths: new Map(),
  policy: {
    defaultRegistry: null,
    scopedRegistries: [],
    unknownRouting: false,
    publicAuthPresent: false,
    changeUnsupported: false,
  },
});

function applySetting(
  source: IYarnSettings,
  rawName: string,
  value: unknown,
  origin: 'yarnrc' | 'npmrc' | 'env' = 'yarnrc',
): void {
  const lower = rawName.toLowerCase();
  const name = canonical(rawName);
  if (
    /^(?:\/\/.*:)?(?:_authtoken|_auth|_password|username|email|always-auth)$/i.test(
      rawName,
    )
  ) {
    if (
      !lower.startsWith('//') ||
      lower.startsWith('//registry.npmjs.org/:') ||
      lower.startsWith('//registry.yarnpkg.com/:')
    )
      source.policy.publicAuthPresent = true;
    return;
  }
  if (dynamic(rawName) || (typeof value === 'string' && dynamic(value)))
    return refuse();

  if (origin !== 'npmrc' && (name === 'config' || name === 'useyarnrc'))
    return refuse();

  if (CHANGE_UNSUPPORTED_OPTIONS.test(name)) {
    source.policy.changeUnsupported = true;
    return;
  }
  if (PATH_OPTIONS.has(name)) {
    const validated = absolute(value);
    if (
      source.paths.has(name) &&
      key(source.paths.get(name)!) !== key(validated)
    )
      return refuse();
    source.paths.set(name, validated);
    return;
  }
  if (origin === 'npmrc' && SHARED_NPMRC_PATH_OPTIONS.has(name)) {
    absolute(value);
    return;
  }
  if (['userconfig', 'globalconfig'].includes(name) && origin === 'env') return;
  if (UNPROVEN_PATH_OPTIONS.test(name)) return refuse();

  if (name === 'registry') {
    const isPublic =
      typeof value === 'string' && PUBLIC_YARN_REGISTRIES.has(value.trim());
    source.policy.defaultRegistry =
      isPublic && source.policy.defaultRegistry !== 'custom'
        ? 'public'
        : 'custom';
  } else if (/^@[^:]+:registry$/.test(lower)) {
    const scope = lower.slice(0, -9);
    if (!isGlobalPackageName(`${scope}/test`))
      source.policy.unknownRouting = true;
    source.policy.scopedRegistries = [
      ...new Set([...source.policy.scopedRegistries, scope]),
    ].sort();
  } else if (name.includes('registr')) {
    source.policy.unknownRouting = true;
  }
}

function iniValue(raw: string): unknown {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.startsWith("'") ? value.slice(1, -1) : value;
    try {
      return JSON.parse(inner) as unknown;
    } catch {
      return inner;
    }
  }
  let escaped = false;
  let result = '';
  for (const char of value) {
    if (escaped) {
      result += '\\;#'.includes(char) ? char : `\\${char}`;
      escaped = false;
    } else if (char === ';' || char === '#') break;
    else if (char === '\\') escaped = true;
    else result += char;
  }
  if (escaped) result += '\\';
  return result.trim();
}

function parseNpmrc(text: string): IYarnSettings {
  const result = emptySettings();
  const seen = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^[#;]/.test(trimmed)) continue;
    const match = /^([^=]+)=(.*)$/.exec(trimmed);
    if (!match || trimmed.startsWith('[')) return refuse();
    let raw = match[1].trim();
    if (/^["']/.test(raw)) {
      if (!raw.endsWith(raw[0])) return refuse();
      raw = raw.slice(1, -1);
    }
    if (/[\\#;]/.test(raw)) return refuse();
    if (raw.endsWith('[]')) {
      const normalized = canonical(raw.slice(0, -2));
      if (PATH_OPTIONS.has(normalized)) return refuse();
      result.policy.changeUnsupported = true;
      continue;
    }
    const value = iniValue(match[2]);
    const normalized = canonical(raw);
    const fingerprint = createHash('sha256')
      .update(typeof value === 'string' ? value : JSON.stringify(value))
      .digest('hex');
    if (seen.has(normalized) && seen.get(normalized) !== fingerprint)
      return refuse();
    seen.set(normalized, fingerprint);
    applySetting(result, raw, value, 'npmrc');
  }
  return result;
}

function unquoteYarnToken(token: string): string {
  if (token.startsWith('"')) {
    if (token.length < 2 || !token.endsWith('"')) return refuse();
    try {
      const parsed: unknown = JSON.parse(token);
      if (typeof parsed !== 'string') return refuse();
      return parsed;
    } catch {
      return refuse();
    }
  }
  if (token.startsWith("'")) {
    if (token.length < 2 || !token.endsWith("'")) return refuse();
    return token.slice(1, -1);
  }
  return token;
}

function tokenizeYarnrcLine(line: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    if (line[i] === '#') break;
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      const start = i;
      i++;
      let closed = false;
      while (i < line.length) {
        if (quote === '"' && line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) return refuse();
      tokens.push(unquoteYarnToken(line.slice(start, i)));
    } else {
      const start = i;
      while (i < line.length && !/\s/.test(line[i]) && line[i] !== '#') i++;
      const word = line.slice(start, i);
      if (word.includes('"') || word.includes("'")) return refuse();
      tokens.push(word);
    }
  }
  return tokens;
}

function parseYarnrc(text: string): IYarnSettings {
  const result = emptySettings();
  const seen = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('<<<<<<<') || trimmed.startsWith('>>>>>>>'))
      return refuse();
    const tokens = tokenizeYarnrcLine(trimmed);
    if (!tokens.length) continue;
    let rawKey = tokens[0].startsWith('--') ? tokens[0].slice(2) : tokens[0];
    rawKey = rawKey.trim();
    if (!rawKey) return refuse();
    const value =
      tokens.length === 1 ? 'true' : tokens.length === 2 ? tokens[1] : refuse();
    const normalized = canonical(rawKey);
    const fingerprint = createHash('sha256').update(value).digest('hex');
    if (seen.has(normalized) && seen.get(normalized) !== fingerprint)
      return refuse();
    seen.set(normalized, fingerprint);
    applySetting(result, rawKey, value, 'yarnrc');
  }
  return result;
}

function combineSettings(target: IYarnSettings, source: IYarnSettings): void {
  for (const [name, value] of source.paths) {
    if (target.paths.has(name) && key(target.paths.get(name)!) !== key(value))
      return refuse();
    target.paths.set(name, value);
  }
  const a = target.policy;
  const b = source.policy;
  a.defaultRegistry =
    a.defaultRegistry === 'custom' || b.defaultRegistry === 'custom'
      ? 'custom'
      : (a.defaultRegistry ?? b.defaultRegistry);
  a.scopedRegistries = [
    ...new Set([...a.scopedRegistries, ...b.scopedRegistries]),
  ].sort();
  a.publicAuthPresent ||= b.publicAuthPresent;
  a.unknownRouting ||= b.unknownRouting;
  a.changeUnsupported ||= b.changeUnsupported;
}

export function assertYarnLocationLayout(
  config: Pick<
    IYarnGlobalConfig,
    'prefixDir' | 'globalDir' | 'globalRoot' | 'binDir' | 'cacheDir'
  >,
): void {
  for (const p of [
    config.prefixDir,
    config.globalDir,
    config.globalRoot,
    config.binDir,
    config.cacheDir,
  ]) {
    if (!isGlobalAbsolutePath(p)) return refuse('LOCATION_AMBIGUOUS');
  }
  if (
    win32.parse(config.globalDir).root.toLowerCase() !==
    win32.parse(config.binDir).root.toLowerCase()
  )
    return refuse('CONFIG_UNSUPPORTED');
  if (
    overlaps(config.globalDir, config.binDir) ||
    overlaps(config.globalRoot, config.binDir) ||
    overlaps(config.cacheDir, config.globalDir) ||
    overlaps(config.cacheDir, config.binDir)
  )
    return refuse('LOCATION_AMBIGUOUS');
}

export async function readYarnGlobalConfig(
  deps: IYarnGlobalConfigDeps,
): Promise<IYarnGlobalConfig> {
  const { fs, signal, environment } = deps;
  signal.throwIfAborted();
  try {
    let bytes = 0;
    const selected: Record<string, string> = {};
    const envSettings = emptySettings();
    const envSeen = new Map<string, string>();
    let rawPath = '';
    for (const [rawName, value] of Object.entries(environment)) {
      if (value === undefined) continue;
      bytes += Buffer.byteLength(rawName) + Buffer.byteLength(value);
      if (bytes > GLOBAL_CONFIG_TOTAL_LIMIT) return refuse('LIMIT_EXCEEDED');
      const lower = rawName.toLowerCase();
      if (lower === 'path') {
        if (envSeen.has(lower) && rawPath !== value) return refuse();
        rawPath = value;
        envSeen.set(lower, value);
        continue;
      }
      if (
        ['userprofile', 'home', 'localappdata', 'appdata'].includes(lower) &&
        value
      ) {
        const normalized = absolute(value);
        if (selected[lower] && key(selected[lower]) !== key(normalized))
          return refuse();
        selected[lower] = normalized;
        continue;
      }
      if (lower === 'npm_token' || lower === 'node_auth_token') {
        envSettings.policy.publicAuthPresent = true;
        continue;
      }
      if (lower === 'prefix' && value) {
        const normalized = absolute(value);
        selected.PREFIX = normalized;
        applySetting(envSettings, 'prefix', normalized, 'env');
        continue;
      }
      if (lower.startsWith('yarn_') && value) {
        const option = rawName.slice(5).replace(/_/g, '-');
        const norm = canonical(option);
        if (['ignorepath', 'enabletelemetry'].includes(norm)) continue;
        if (norm === 'config' || norm === 'useyarnrc') return refuse();
        if (norm === 'globalfolder' || norm === 'cachefolder') {
          const normalized = absolute(value);
          selected[
            lower === 'yarn_cache_folder' ? 'YARN_CACHE_FOLDER' : rawName
          ] = normalized;
        }
        applySetting(envSettings, option, value, 'env');
        continue;
      }
      if (lower.startsWith('npm_config_') && value) {
        const option = lower
          .slice(11)
          .replace(
            /(^|:)([^:]+)/g,
            (_match, prefix: string, part: string) =>
              prefix + part[0] + part.slice(1).replace(/_/g, '-'),
          );
        const norm = canonical(option);
        const fingerprint = createHash('sha256').update(value).digest('hex');
        if (envSeen.has(norm) && envSeen.get(norm) !== fingerprint)
          return refuse();
        envSeen.set(norm, fingerprint);
        if (norm === 'prefix') selected.npm_config_prefix = absolute(value);
        if (
          [
            'useragent',
            'localprefix',
            'globalprefix',
            'npmversion',
            'nodegyp',
            'initmodule',
          ].includes(norm)
        )
          continue;
        applySetting(envSettings, option, value, 'npmrc');
      }
    }

    const profile = selected.userprofile ?? selected.home;
    if (!profile) return refuse();
    const localAppData: string | undefined = selected.localappdata;

    const userYarnrc = win32.join(profile, '.yarnrc');
    const userYarnrcYml = win32.join(profile, '.yarnrc.yml');
    const userNpmrc = win32.join(profile, '.npmrc');
    const preliminaryPrefix =
      envSettings.paths.get('prefix') ??
      (localAppData ? win32.join(localAppData, 'Yarn') : null);
    const prelimGlobalYarnrc = preliminaryPrefix
      ? win32.join(preliminaryPrefix, 'etc', 'yarnrc')
      : null;
    const prelimGlobalNpmrc = preliminaryPrefix
      ? win32.join(preliminaryPrefix, 'etc', 'npmrc')
      : null;

    const configIdentities: IGlobalConfigIdentity[] = [];
    const missingConfigPaths: string[] = [];
    const budget = { remaining: GLOBAL_CONFIG_TOTAL_LIMIT - bytes };
    const readCache = new Map<string, string | null>();
    const readConfigFile = async (file: string): Promise<string | null> => {
      if (readCache.has(key(file))) return readCache.get(key(file))!;
      const data = await readPnpm10File(
        file,
        GLOBAL_CONFIG_FILE_LIMIT,
        fs,
        signal,
        budget,
        () => deps.checkDirectory(win32.dirname(file)),
      );
      if (data) configIdentities.push(data.identity);
      else missingConfigPaths.push(file);
      readCache.set(key(file), data?.text ?? null);
      return data?.text ?? null;
    };

    if ((await readConfigFile(userYarnrcYml)) !== null) return refuse();

    const effective = emptySettings();
    const npmrcText = await readConfigFile(userNpmrc);
    if (npmrcText !== null) combineSettings(effective, parseNpmrc(npmrcText));
    const prelimGlobalNpmrcText = prelimGlobalNpmrc
      ? await readConfigFile(prelimGlobalNpmrc)
      : null;
    if (prelimGlobalNpmrcText !== null)
      combineSettings(effective, parseNpmrc(prelimGlobalNpmrcText));
    const yarnrcText = await readConfigFile(userYarnrc);
    if (yarnrcText !== null)
      combineSettings(effective, parseYarnrc(yarnrcText));
    const prelimGlobalYarnrcText = prelimGlobalYarnrc
      ? await readConfigFile(prelimGlobalYarnrc)
      : null;
    if (prelimGlobalYarnrcText !== null)
      combineSettings(effective, parseYarnrc(prelimGlobalYarnrcText));
    combineSettings(effective, envSettings);

    if (
      !localAppData &&
      (!effective.paths.has('prefix') ||
        !effective.paths.has('globalfolder') ||
        !effective.paths.has('cachefolder'))
    )
      return refuse();

    const explicitPrefix = effective.paths.has('prefix');
    const prefixDir =
      effective.paths.get('prefix') ??
      (localAppData ? win32.join(localAppData, 'Yarn') : null);
    if (!prefixDir) return refuse();
    const globalYarnrc = win32.join(prefixDir, 'etc', 'yarnrc');
    const globalNpmrc = win32.join(prefixDir, 'etc', 'npmrc');
    if (!prelimGlobalNpmrc || key(globalNpmrc) !== key(prelimGlobalNpmrc)) {
      const extraNpmrc = await readConfigFile(globalNpmrc);
      if (extraNpmrc !== null)
        combineSettings(effective, parseNpmrc(extraNpmrc));
    }
    if (!prelimGlobalYarnrc || key(globalYarnrc) !== key(prelimGlobalYarnrc)) {
      const extraYarnrc = await readConfigFile(globalYarnrc);
      if (extraYarnrc !== null)
        combineSettings(effective, parseYarnrc(extraYarnrc));
    }

    const globalDir =
      effective.paths.get('globalfolder') ??
      (localAppData
        ? win32.join(localAppData, 'Yarn', 'Data', 'global')
        : null);
    if (!globalDir) return refuse();
    const globalRoot = win32.join(globalDir, 'node_modules');
    const binDir = win32.join(prefixDir, 'bin');
    const cacheDir =
      effective.paths.get('cachefolder') ??
      (localAppData ? win32.join(localAppData, 'Yarn', 'Cache') : null);
    if (!cacheDir) return refuse();
    const mutexFile = win32.join(deps.dataDir, 'cache', 'yarn-global.mutex');

    assertYarnLocationLayout({
      prefixDir,
      globalDir,
      globalRoot,
      binDir,
      cacheDir,
    });

    const originalPath = rawPath
      .split(';')
      .filter((entry) => isGlobalAbsolutePath(entry));
    const binOnPath = originalPath.some((entry) => key(entry) === key(binDir));

    const directoryIdentities: IRunnerFileIdentity[] = [];
    const missingDirectoryPaths: string[] = [];
    for (const directory of [
      ...new Set([
        prefixDir,
        binDir,
        globalDir,
        globalRoot,
        cacheDir,
        deps.cwd,
      ]),
    ]) {
      await deps.checkDirectory(directory);
      signal.throwIfAborted();
      try {
        const stat = await fs.lstat(directory);
        signal.throwIfAborted();
        if (
          !stat.isDirectory?.() ||
          stat.isSymbolicLink() ||
          key(await fs.realpath(directory)) !== key(directory)
        )
          return refuse();
        signal.throwIfAborted();
        directoryIdentities.push(runnerIdentity(directory, stat));
      } catch (error) {
        signal.throwIfAborted();
        if (!absent(error)) throw error;
        missingDirectoryPaths.push(directory);
      }
    }

    for (const file of configIdentities) {
      await deps.checkDirectory(win32.dirname(file.file.path));
      signal.throwIfAborted();
      const stat = await fs.lstat(file.file.path);
      signal.throwIfAborted();
      if (
        !sameRunnerIdentity(file.file.stat, stat) ||
        key(await fs.realpath(file.file.path)) !== key(file.file.path)
      )
        return refuse();
      signal.throwIfAborted();
    }
    for (const missingPath of [
      ...missingConfigPaths,
      ...missingDirectoryPaths,
    ]) {
      try {
        await fs.lstat(missingPath);
        signal.throwIfAborted();
      } catch (error) {
        signal.throwIfAborted();
        if (absent(error)) continue;
        throw error;
      }
      return refuse();
    }

    signal.throwIfAborted();
    return {
      prefixDir,
      globalDir,
      globalRoot,
      binDir,
      cacheDir,
      mutexFile,
      userYarnrc,
      globalYarnrc,
      userNpmrc,
      globalNpmrc,
      binOnPath,
      explicitPrefix,
      originalPath,
      selectors: selected,
      configIdentities,
      missingConfigPaths,
      directoryIdentities,
      missingDirectoryPaths,
      policy: effective.policy,
    };
  } catch (error) {
    signal.throwIfAborted();
    if (
      error instanceof AppException &&
      record(error.details) &&
      ['CONFIG_UNSUPPORTED', 'LIMIT_EXCEEDED', 'LOCATION_AMBIGUOUS'].includes(
        String(error.details.reason),
      )
    )
      throw error;
    return refuse();
  }
}
