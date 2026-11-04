import { win32 } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AppException } from '@/common/exceptions/app.exception';
import { GLOBAL_ENVIRONMENT_KEYS } from '@/global-packages/interfaces/global-packages.runtime';
import type {
  GlobalEnvironmentCapture,
  GlobalEnvironmentKey,
  IGlobalConfigIdentity,
  IGlobalNpmrcPolicy,
  IGlobalRegistryDecision,
  IGlobalRegistryInput,
} from '@/global-packages/interfaces/global-packages.runtime';
import { isGlobalPackageName } from '@/global-packages/global-policy';

export const GLOBAL_CONFIG_FILE_LIMIT = 1024 * 1024;
export const GLOBAL_CONFIG_TOTAL_LIMIT = 8 * 1024 * 1024;

const refuse = (
  reason: 'CONFIG_UNSUPPORTED' | 'LIMIT_EXCEEDED' | 'PREVIEW_CHANGED',
): never => {
  throw new AppException(
    409,
    'Global configuration cannot be used',
    'CONFLICT',
    {
      reason,
    },
  );
};
const hasControl = (value: string): boolean =>
  Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const substituted = (value: string): boolean =>
  value.includes('${') || value.includes('$(') || value.includes('`');
const absoluteLocation = (value: string): boolean =>
  value.length <= 32767 &&
  /^[a-z]:[\\/]/i.test(value) &&
  win32.isAbsolute(value) &&
  !hasControl(value) &&
  !substituted(value) &&
  !value.slice(2).includes(':') &&
  !/[<>"|?*]/.test(value);

export function captureGlobalEnvironment(
  snapshot: Readonly<NodeJS.ProcessEnv>,
): GlobalEnvironmentCapture {
  const captured: Partial<Record<GlobalEnvironmentKey, string>> = {};
  for (const key of Object.keys(snapshot)) {
    const canonical = GLOBAL_ENVIRONMENT_KEYS.find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (!canonical) continue;
    const value = snapshot[key];
    if (value === undefined) continue;
    if (
      !absoluteLocation(value) ||
      (captured[canonical] !== undefined && captured[canonical] !== value)
    )
      return refuse('CONFIG_UNSUPPORTED');
    captured[canonical] = value;
  }
  return captured;
}

const publicRegistry = (value: string): boolean =>
  value === 'https://registry.npmjs.org' ||
  value === 'https://registry.npmjs.org/';
const authKey = (key: string): boolean =>
  /^\/\/[^/]+\/.*:(?:_authtoken|_auth|_password|username|email|always-auth)$/.test(
    key,
  );
const locationKeys = new Set([
  'prefix',
  'userconfig',
  'globalconfig',
  'cache',
  'global-dir',
  'global-bin-dir',
  'store-dir',
]);
const inertKeys = new Set([
  'audit',
  'fund',
  'progress',
  'color',
  'update-notifier',
  'save-exact',
  'save-prefix',
  'loglevel',
  'user-agent',
  'always-auth',
]);
const policySummary = (): IGlobalNpmrcPolicy => ({
  defaultRegistry: null,
  scopedRegistries: [],
  publicAuthPresent: false,
  provenanceKnown: true,
});

// Authentication entries are handled by key before their value is inspected.
const recordAuth = (summary: IGlobalNpmrcPolicy, key: string): boolean => {
  if (!authKey(key)) return false;
  if (key.startsWith('//registry.npmjs.org/:'))
    summary.publicAuthPresent = true;
  return true;
};
const inspectEntry = (
  summary: IGlobalNpmrcPolicy,
  key: string,
  raw: string,
): void => {
  const value = raw.trim();
  if (
    !key ||
    hasControl(key) ||
    hasControl(value) ||
    substituted(key) ||
    substituted(value)
  ) {
    summary.provenanceKnown = false;
    return;
  }
  if (key === 'registry') {
    const registry = publicRegistry(value) ? 'public' : 'custom';
    // A later override must not conceal a source using a different registry.
    if (summary.defaultRegistry !== 'custom')
      summary.defaultRegistry = registry;
    return;
  }
  const scoped = /^(@[^:]+):registry$/.exec(key);
  if (scoped) {
    if (!isGlobalPackageName(`${scoped[1]}/test-package`) || !value)
      summary.provenanceKnown = false;
    else if (!summary.scopedRegistries.includes(scoped[1]))
      summary.scopedRegistries.push(scoped[1]);
    return;
  }
  if (locationKeys.has(key)) {
    if (!absoluteLocation(value)) summary.provenanceKnown = false;
  } else if (!inertKeys.has(key)) summary.provenanceKnown = false;
};

export function parseGlobalNpmrc(text: string): IGlobalNpmrcPolicy {
  if (Buffer.byteLength(text, 'utf8') > GLOBAL_CONFIG_FILE_LIMIT)
    return refuse('LIMIT_EXCEEDED');
  const summary = policySummary();
  const seen = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';'))
      continue;
    const separator = trimmed.indexOf('=');
    const key = (separator < 0 ? trimmed : trimmed.slice(0, separator))
      .trim()
      .toLowerCase();
    if (recordAuth(summary, key)) continue;
    if (separator < 0) {
      summary.provenanceKnown = false;
      continue;
    }
    const value = trimmed.slice(separator + 1).trim();
    if (seen.has(key) && seen.get(key) !== value)
      summary.provenanceKnown = false;
    seen.set(key, value);
    inspectEntry(summary, key, value);
  }
  summary.scopedRegistries.sort();
  return summary;
}

const inspectRegistryEnvironment = (
  environment: Readonly<NodeJS.ProcessEnv>,
): IGlobalNpmrcPolicy => {
  const summary = policySummary();
  const seen = new Map<string, string>();
  let bytes = 0;
  for (const key of Object.keys(environment)) {
    const lower = key.toLowerCase();
    if (lower === 'npm_token' || lower === 'node_auth_token') {
      summary.publicAuthPresent = true;
      continue;
    }
    if (!lower.startsWith('npm_config_') && !lower.startsWith('pnpm_config_'))
      continue;
    const rawKey = lower.replace(/^(?:npm|pnpm)_config_/, '');
    if (recordAuth(summary, rawKey)) continue;
    const value = environment[key];
    if (value === undefined) continue;
    bytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (bytes > GLOBAL_CONFIG_TOTAL_LIMIT) return refuse('LIMIT_EXCEEDED');
    if (seen.has(lower) && seen.get(lower) !== value)
      summary.provenanceKnown = false;
    seen.set(lower, value);
    inspectEntry(summary, rawKey.replace(/_/g, '-'), value);
  }
  return summary;
};

export function assessGlobalRegistryPolicy(
  input: IGlobalRegistryInput,
): IGlobalRegistryDecision {
  if (
    input.configs.reduce(
      (bytes, text) => bytes + Buffer.byteLength(text, 'utf8'),
      0,
    ) > GLOBAL_CONFIG_TOTAL_LIMIT
  )
    return refuse('LIMIT_EXCEEDED');
  const summaries = input.configs.map(parseGlobalNpmrc);
  summaries.push(inspectRegistryEnvironment(input.environment));
  const scope = input.packageName.startsWith('@')
    ? input.packageName.split('/')[0]
    : null;
  const unsupported =
    !input.provenanceKnown ||
    !isGlobalPackageName(input.packageName) ||
    summaries.some(
      (summary) =>
        !summary.provenanceKnown ||
        summary.defaultRegistry === 'custom' ||
        (scope !== null && summary.scopedRegistries.includes(scope)),
    );
  const refused = input.action === 'change' && unsupported;
  return {
    changeAllowed: !unsupported,
    reason: refused ? 'REGISTRY_CONFIG_UNSUPPORTED' : null,
    publicAuthPresent: summaries.some((summary) => summary.publicAuthPresent),
  };
}

const configKey = (identity: IGlobalConfigIdentity): string =>
  win32.resolve(identity.file.path).toLowerCase();
const statFacts = (identity: IGlobalConfigIdentity): Record<string, unknown> =>
  Object.fromEntries<unknown>(
    Object.entries(identity.file.stat).filter(
      // Reading config can change access time; content/identity clocks still matter.
      ([key, value]) =>
        typeof value !== 'function' && !/^atime(?:ms|ns)?$/i.test(key),
    ),
  );

export function assertGlobalConfigUnchanged(
  expected: readonly IGlobalConfigIdentity[],
  actual: readonly IGlobalConfigIdentity[],
): void {
  const current = new Map(
    actual.map((identity) => [configKey(identity), identity]),
  );
  const previous = new Set(expected.map(configKey));
  if (
    previous.size !== expected.length ||
    current.size !== actual.length ||
    expected.length !== actual.length
  )
    return refuse('PREVIEW_CHANGED');
  for (const identity of expected) {
    const candidate = current.get(configKey(identity));
    if (
      !candidate ||
      candidate.sha256 !== identity.sha256 ||
      !isDeepStrictEqual(statFacts(identity), statFacts(candidate))
    )
      return refuse('PREVIEW_CHANGED');
  }
}
