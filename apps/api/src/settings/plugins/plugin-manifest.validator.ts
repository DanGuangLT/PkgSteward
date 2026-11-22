import {
  PLUGIN_API_VERSION,
  PLUGIN_CAPABILITIES,
  PLUGIN_ID_REGEX,
} from '@/settings/plugins/interfaces/plugin.types';
import type {
  IPluginManifest,
  IPluginSettingFieldSchema,
  PluginCapability,
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
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_CAPABILITIES = 5;
const MAX_SCHEMA_FIELDS = 25;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertSafeKeys = (
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  scope: string,
) => {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Forbidden key "${key}" in ${scope}`);
    }
    if (!allowed.has(key)) {
      throw new Error(`Unknown key "${key}" in ${scope}`);
    }
  }
};

const optionalText = (
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`"${field}" must be a non-empty string when present`);
  }
  if (value.trim().length > maxLength) {
    throw new Error(`"${field}" exceeds ${maxLength} characters`);
  }
  return value.trim();
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
      'Manifest "capabilities" must contain 1..5 valid capabilities',
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

  let homepage: string | undefined;
  if (raw.homepage !== undefined) {
    if (typeof raw.homepage !== 'string') {
      throw new Error('Manifest "homepage" must be a URL string');
    }
    let url: URL;
    try {
      url = new URL(raw.homepage.trim());
    } catch {
      throw new Error('Manifest "homepage" must be a valid https:// URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Manifest "homepage" must use https:// or http://');
    }
    homepage = url.toString();
  }

  const settingsSchema: IPluginSettingFieldSchema[] = [];
  if (raw.settingsSchema !== undefined) {
    if (
      !Array.isArray(raw.settingsSchema) ||
      raw.settingsSchema.length > MAX_SCHEMA_FIELDS
    ) {
      throw new Error(
        `Manifest "settingsSchema" must be an array of <= ${MAX_SCHEMA_FIELDS} items`,
      );
    }
    const seenKeys = new Set<string>();
    raw.settingsSchema.forEach((field, index) => {
      const parsed = validateSettingField(field, index);
      if (seenKeys.has(parsed.key)) {
        throw new Error(`Duplicate settingsSchema key "${parsed.key}"`);
      }
      seenKeys.add(parsed.key);
      settingsSchema.push(parsed);
    });
  }

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
