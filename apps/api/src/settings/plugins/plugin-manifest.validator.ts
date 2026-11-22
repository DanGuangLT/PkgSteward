import {
  PLUGIN_API_VERSION,
  PLUGIN_CAPABILITIES,
  PLUGIN_ID_REGEX,
} from '@/settings/plugins/interfaces/plugin.types';
import type {
  IPluginEntryPoint,
  IPluginManifest,
  IPluginSettingFieldSchema,
  PluginCapability,
  PluginEntryKind,
  PluginManifestFormat,
} from '@/settings/plugins/interfaces/plugin.types';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MANIFEST_KEYS = new Set([
  'id',
  'name',
  'version',
  'apiVersion',
  'description',
  'author',
  'homepage',
  'capabilities',
  'minAppVersion',
  'settingsSchema',
]);
const FIELD_KEYS = new Set([
  'key',
  'label',
  'type',
  'defaultValue',
  'description',
]);
const ENTRY_KINDS = new Set<PluginEntryKind>([
  'none',
  'builtin-wallpaper',
  'web-sandbox',
  'media-image',
  'media-video',
  'css-theme',
]);
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_CAPABILITIES = 6;
const MAX_SCHEMA_FIELDS = 25;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertSafeKeys = (
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string> | null,
  scope: string,
) => {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Forbidden key "${key}" in ${scope}`);
    }
    if (allowed !== null && !allowed.has(key)) {
      throw new Error(`Unknown key "${key}" in ${scope}`);
    }
  }
};

const assertNoForbiddenKeysDeep = (
  value: unknown,
  scope: string,
  depth = 0,
): void => {
  if (depth > 12 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoForbiddenKeysDeep(item, `${scope}[${index}]`, depth + 1),
    );
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Forbidden key "${key}" in ${scope}`);
    }
    assertNoForbiddenKeysDeep(record[key], `${scope}.${key}`, depth + 1);
  }
};

const optionalText = (
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`"${field}" must be a non-empty string when present`);
  }
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > maxLength) {
    throw new Error(`"${field}" exceeds ${maxLength} characters`);
  }
  return trimmed;
};

export const sanitizeRelativeAssetRef = (
  rawPath: unknown,
  field = 'entry.file',
): string => {
  if (typeof rawPath !== 'string' || rawPath.includes('\0')) {
    throw new Error(`"${field}" must be a relative file path`);
  }
  const normalized = rawPath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)
  ) {
    throw new Error(`"${field}" must not be absolute or use a URL scheme`);
  }
  const segments = normalized.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error(`"${field}" must not contain traversal segments`);
  }
  return segments.join('/');
};

export const slugifyPluginId = (raw: string): string => {
  let cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\//g, '.')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!cleaned) cleaned = 'custom-plugin';
  cleaned = cleaned.slice(0, 64);
  if (!PLUGIN_ID_REGEX.test(cleaned)) {
    return 'custom-plugin';
  }
  return cleaned;
};

const extractAuthorText = (rawAuthor: unknown): string | undefined => {
  if (typeof rawAuthor === 'string') {
    return optionalText(rawAuthor, 'author', 120);
  }
  if (isRecord(rawAuthor) && typeof rawAuthor.name === 'string') {
    return optionalText(rawAuthor.name, 'author.name', 120);
  }
  return undefined;
};

const extractSafeHomepage = (rawHomepage: unknown): string | undefined => {
  if (rawHomepage === undefined || rawHomepage === null || rawHomepage === '') {
    return undefined;
  }
  if (typeof rawHomepage !== 'string') {
    throw new Error('Manifest "homepage" must be a URL string');
  }
  let url: URL;
  try {
    url = new URL(rawHomepage.trim());
  } catch {
    throw new Error('Manifest "homepage" must be a valid https:// URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Manifest "homepage" must use https:// or http://');
  }
  return url.toString();
};

const inferEntryKindFromFile = (relPath: string): PluginEntryKind => {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'web-sandbox';
  if (lower.endsWith('.css')) return 'css-theme';
  if (/\.(mp4|webm|ogg)$/i.test(lower)) return 'media-video';
  if (/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(lower)) return 'media-image';
  return 'none';
};

const validateSettingField = (
  raw: unknown,
  index: number,
): IPluginSettingFieldSchema => {
  const scope = `settingsSchema[${index}]`;
  if (!isRecord(raw)) {
    throw new Error(`"${scope}" must be an object`);
  }
  assertSafeKeys(raw, FIELD_KEYS, scope);
  if (
    typeof raw.key !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(raw.key) ||
    FORBIDDEN_KEYS.has(raw.key)
  ) {
    throw new Error(`"${scope}.key" must be a valid field identifier`);
  }
  if (
    typeof raw.label !== 'string' ||
    raw.label.trim() === '' ||
    raw.label.trim().length > 100
  ) {
    throw new Error(`"${scope}.label" must be a non-empty string`);
  }
  if (
    raw.type !== 'string' &&
    raw.type !== 'number' &&
    raw.type !== 'boolean'
  ) {
    throw new Error(`"${scope}.type" must be string, number, or boolean`);
  }
  const rawDefault = raw.defaultValue ?? null;
  let defaultValue: string | number | boolean | null = null;
  if (rawDefault !== null) {
    if (raw.type === 'number') {
      if (typeof rawDefault !== 'number' || !Number.isFinite(rawDefault)) {
        throw new Error(`"${scope}.defaultValue" must be a finite number`);
      }
      defaultValue = rawDefault;
    } else if (typeof rawDefault === raw.type) {
      defaultValue = rawDefault as string | boolean;
    } else {
      throw new Error(`"${scope}.defaultValue" must match type "${raw.type}"`);
    }
  }
  const description = optionalText(
    raw.description,
    `${scope}.description`,
    300,
  );
  return {
    key: raw.key,
    label: raw.label.trim(),
    type: raw.type,
    defaultValue,
    ...(description ? { description } : {}),
  };
};

const parseSchemaFieldsArray = (raw: unknown): IPluginSettingFieldSchema[] => {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SCHEMA_FIELDS) {
    throw new Error(
      `Manifest "settingsSchema" must be an array of <= ${MAX_SCHEMA_FIELDS} items`,
    );
  }
  const out: IPluginSettingFieldSchema[] = [];
  const seenKeys = new Set<string>();
  raw.forEach((field, index) => {
    const parsed = validateSettingField(field, index);
    if (seenKeys.has(parsed.key)) {
      throw new Error(`Duplicate settingsSchema key "${parsed.key}"`);
    }
    seenKeys.add(parsed.key);
    out.push(parsed);
  });
  return out;
};

const normalizeCapabilities = (
  rawCaps: unknown,
  fallbackCap: PluginCapability,
): PluginCapability[] => {
  if (rawCaps === undefined) return [fallbackCap];
  if (!Array.isArray(rawCaps) || rawCaps.length === 0) {
    return [fallbackCap];
  }
  const out: PluginCapability[] = [];
  for (const item of rawCaps.slice(0, MAX_CAPABILITIES)) {
    if (
      typeof item === 'string' &&
      PLUGIN_CAPABILITIES.includes(item as PluginCapability) &&
      !out.includes(item as PluginCapability)
    ) {
      out.push(item as PluginCapability);
    }
  }
  return out.length > 0 ? out : [fallbackCap];
};

const parseEntryObject = (rawEntry: unknown): IPluginEntryPoint | undefined => {
  if (rawEntry === undefined) return undefined;
  if (!isRecord(rawEntry)) {
    throw new Error('Manifest "entry" must be an object');
  }
  assertSafeKeys(rawEntry, new Set(['kind', 'file']), 'entry');
  const kindRaw = rawEntry.kind;
  if (
    typeof kindRaw !== 'string' ||
    !ENTRY_KINDS.has(kindRaw as PluginEntryKind)
  ) {
    throw new Error(`Unsupported plugin entry kind "${String(kindRaw)}"`);
  }
  const kind = kindRaw as PluginEntryKind;
  if (
    rawEntry.file === undefined ||
    rawEntry.file === null ||
    rawEntry.file === ''
  ) {
    return { kind, file: null };
  }
  return {
    kind,
    file: sanitizeRelativeAssetRef(rawEntry.file, 'entry.file'),
  };
};

export function validatePluginManifest(raw: unknown): IPluginManifest {
  if (!isRecord(raw)) {
    throw new Error('Plugin manifest must be a JSON object');
  }
  assertSafeKeys(raw, MANIFEST_KEYS, 'manifest');

  if (typeof raw.id !== 'string' || !PLUGIN_ID_REGEX.test(raw.id)) {
    throw new Error('Manifest "id" must match ^[a-z0-9][a-z0-9._-]{0,63}$');
  }
  if (
    typeof raw.name !== 'string' ||
    raw.name.trim() === '' ||
    raw.name.trim().length > 80
  ) {
    throw new Error('Manifest "name" must be a non-empty string (<= 80 chars)');
  }
  if (typeof raw.version !== 'string' || !SEMVER_REGEX.test(raw.version)) {
    throw new Error('Manifest "version" must be valid semver');
  }
  if (raw.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `Manifest "apiVersion" must be ${PLUGIN_API_VERSION} (got ${String(raw.apiVersion)})`,
    );
  }
  if (
    !Array.isArray(raw.capabilities) ||
    raw.capabilities.length === 0 ||
    raw.capabilities.length > MAX_CAPABILITIES
  ) {
    throw new Error(
      `Manifest "capabilities" must contain 1..${MAX_CAPABILITIES} valid capabilities`,
    );
  }
  const capabilities: PluginCapability[] = [];
  for (const item of raw.capabilities) {
    if (
      typeof item !== 'string' ||
      !PLUGIN_CAPABILITIES.includes(item as PluginCapability)
    ) {
      throw new Error(`Unsupported plugin capability "${String(item)}"`);
    }
    if (!capabilities.includes(item as PluginCapability)) {
      capabilities.push(item as PluginCapability);
    }
  }

  const homepage = extractSafeHomepage(raw.homepage);
  const settingsSchema = parseSchemaFieldsArray(raw.settingsSchema);
  const description = optionalText(raw.description, 'description', 400);
  const author = optionalText(raw.author, 'author', 120);
  const minAppVersion = optionalText(raw.minAppVersion, 'minAppVersion', 32);

  return {
    id: raw.id,
    name: raw.name.trim(),
    version: raw.version,
    apiVersion: PLUGIN_API_VERSION,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    capabilities,
    ...(minAppVersion ? { minAppVersion } : {}),
    settingsSchema,
  };
}

export function normalizeStandardPluginManifest(
  format: PluginManifestFormat,
  raw: unknown,
  fallbackId?: string,
): IPluginManifest {
  if (!isRecord(raw)) {
    throw new Error('Plugin manifest must be a JSON object');
  }
  assertNoForbiddenKeysDeep(raw, format);

  if (format === 'pkgsteward.plugin.json') {
    return {
      ...validatePluginManifest(raw),
      format,
      entry: { kind: 'none', file: null },
    };
  }

  if (format === 'project.json') {
    const explicitTitle =
      optionalText(raw.title, 'title', 80) ??
      optionalText(raw.name, 'name', 80);
    const title = explicitTitle ?? fallbackId ?? 'custom-plugin';
    const id =
      typeof raw.id === 'string' && PLUGIN_ID_REGEX.test(raw.id)
        ? raw.id
        : slugifyPluginId(fallbackId || explicitTitle || title);
    const version =
      typeof raw.version === 'string' && SEMVER_REGEX.test(raw.version.trim())
        ? raw.version.trim()
        : '1.0.0';
    const typeLower =
      typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : 'web';
    let entry: IPluginEntryPoint = { kind: 'none', file: null };
    if (typeof raw.file === 'string' && raw.file.trim() !== '') {
      const safeFile = sanitizeRelativeAssetRef(raw.file, 'file');
      const inferred = inferEntryKindFromFile(safeFile);
      const kind: PluginEntryKind =
        typeLower === 'video'
          ? 'media-video'
          : typeLower === 'image' || typeLower === 'scene'
            ? inferred === 'none'
              ? 'media-image'
              : inferred
            : inferred !== 'none'
              ? inferred
              : 'web-sandbox';
      entry = { kind, file: safeFile };
    }

    const settingsSchema: IPluginSettingFieldSchema[] = [];
    if (isRecord(raw.general) && isRecord(raw.general.properties)) {
      const propKeys = Object.getOwnPropertyNames(raw.general.properties).slice(
        0,
        MAX_SCHEMA_FIELDS,
      );
      for (const propKey of propKeys) {
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(propKey) ||
          FORBIDDEN_KEYS.has(propKey)
        ) {
          continue;
        }
        const propDef = raw.general.properties[propKey];
        if (!isRecord(propDef)) continue;
        const propType = (
          typeof propDef.type === 'string' ? propDef.type : 'text'
        ).toLowerCase();
        const label = optionalText(propDef.text, 'text', 100) ?? propKey;
        const val = propDef.value;
        if (propType === 'bool' || typeof val === 'boolean') {
          settingsSchema.push({
            key: propKey,
            label,
            type: 'boolean',
            defaultValue: Boolean(val),
          });
        } else if (propType === 'slider' || typeof val === 'number') {
          settingsSchema.push({
            key: propKey,
            label,
            type: 'number',
            defaultValue:
              typeof val === 'number' && Number.isFinite(val) ? val : 0,
          });
        } else {
          settingsSchema.push({
            key: propKey,
            label,
            type: 'string',
            defaultValue: typeof val === 'string' ? val.slice(0, 200) : '',
          });
        }
      }
    }

    const description = optionalText(raw.description, 'description', 400);
    const author = extractAuthorText(raw.author);
    return {
      id,
      name: title,
      version,
      apiVersion: PLUGIN_API_VERSION,
      format,
      entry,
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      capabilities: ['live-wallpaper'],
      settingsSchema,
    };
  }

  if (format === 'package.json') {
    const rawName = optionalText(raw.name, 'name', 100);
    if (!rawName) {
      throw new Error('package.json manifest requires a "name" field');
    }
    const id = slugifyPluginId(rawName);
    const pkgMeta = isRecord(raw.pkgsteward) ? raw.pkgsteward : {};
    const displayName =
      optionalText(pkgMeta.name, 'pkgsteward.name', 80) ??
      optionalText(raw.displayName, 'displayName', 80) ??
      rawName;
    const versionRaw = optionalText(raw.version, 'version', 64) ?? '1.0.0';
    if (!SEMVER_REGEX.test(versionRaw)) {
      throw new Error('Manifest "version" must be valid semver');
    }

    let entry: IPluginEntryPoint = parseEntryObject(pkgMeta.entry) ?? {
      kind: 'none',
      file: null,
    };
    if (entry.kind === 'none') {
      const candidateFile =
        typeof pkgMeta.file === 'string'
          ? pkgMeta.file
          : typeof raw.main === 'string'
            ? raw.main
            : typeof raw.style === 'string'
              ? raw.style
              : undefined;
      if (candidateFile && candidateFile.trim() !== '') {
        const safeFile = sanitizeRelativeAssetRef(candidateFile, 'main');
        const kind = inferEntryKindFromFile(safeFile);
        if (kind !== 'none') {
          entry = { kind, file: safeFile };
        }
      }
    }

    const defaultCap: PluginCapability =
      entry.kind === 'web-sandbox' ||
      entry.kind === 'media-image' ||
      entry.kind === 'media-video' ||
      entry.kind === 'builtin-wallpaper'
        ? 'live-wallpaper'
        : entry.kind === 'css-theme'
          ? 'theme-preset'
          : 'dashboard-widget';

    const capabilities = normalizeCapabilities(
      pkgMeta.capabilities ?? raw.keywords,
      defaultCap,
    );
    const description = optionalText(raw.description, 'description', 400);
    const author = extractAuthorText(raw.author);
    const homepage = extractSafeHomepage(raw.homepage);
    const settingsSchema = parseSchemaFieldsArray(pkgMeta.settingsSchema);

    return {
      id:
        typeof pkgMeta.id === 'string' && PLUGIN_ID_REGEX.test(pkgMeta.id)
          ? pkgMeta.id
          : id,
      name: displayName.slice(0, 80),
      version: versionRaw,
      apiVersion: PLUGIN_API_VERSION,
      format,
      entry,
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      ...(homepage ? { homepage } : {}),
      capabilities,
      settingsSchema,
    };
  }

  // Standard manifest.json (Web App / Browser / Obsidian / Generic Plugin)
  if (raw.apiVersion !== undefined && raw.apiVersion !== PLUGIN_API_VERSION) {
    const versionText =
      typeof raw.apiVersion === 'number' || typeof raw.apiVersion === 'string'
        ? String(raw.apiVersion)
        : typeof raw.apiVersion;
    throw new Error(
      `Manifest "apiVersion" must be ${PLUGIN_API_VERSION} (got ${versionText})`,
    );
  }
  const explicitName =
    optionalText(raw.name, 'name', 80) ??
    optionalText(raw.short_name, 'short_name', 80) ??
    optionalText(raw.id, 'id', 80);
  const name = explicitName ?? fallbackId ?? 'custom-plugin';
  const id =
    typeof raw.id === 'string' && PLUGIN_ID_REGEX.test(raw.id)
      ? raw.id
      : slugifyPluginId(fallbackId || explicitName || name);
  const version = optionalText(raw.version, 'version', 64) ?? '1.0.0';
  if (!SEMVER_REGEX.test(version)) {
    throw new Error('Manifest "version" must be valid semver');
  }

  let entry = parseEntryObject(raw.entry) ?? { kind: 'none', file: null };
  if (entry.kind === 'none') {
    const fileCandidate =
      typeof raw.file === 'string'
        ? raw.file
        : typeof raw.main === 'string'
          ? raw.main
          : typeof raw.start_url === 'string'
            ? raw.start_url
            : undefined;
    if (fileCandidate && fileCandidate.trim() !== '') {
      const safeFile = sanitizeRelativeAssetRef(fileCandidate, 'main');
      const kind = inferEntryKindFromFile(safeFile);
      if (kind !== 'none') {
        entry = { kind, file: safeFile };
      }
    }
  }

  const defaultCap: PluginCapability =
    entry.kind === 'web-sandbox' ||
    entry.kind === 'media-image' ||
    entry.kind === 'media-video' ||
    entry.kind === 'builtin-wallpaper'
      ? 'live-wallpaper'
      : entry.kind === 'css-theme'
        ? 'theme-preset'
        : 'dashboard-widget';

  const capabilities = normalizeCapabilities(raw.capabilities, defaultCap);
  const settingsSchema = parseSchemaFieldsArray(raw.settingsSchema);
  const description = optionalText(raw.description, 'description', 400);
  const author = extractAuthorText(raw.author);
  const homepage = extractSafeHomepage(raw.homepage);
  const minAppVersion = optionalText(raw.minAppVersion, 'minAppVersion', 32);

  return {
    id,
    name: name.slice(0, 80),
    version,
    apiVersion: PLUGIN_API_VERSION,
    format,
    entry,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    capabilities,
    ...(minAppVersion ? { minAppVersion } : {}),
    settingsSchema,
  };
}
