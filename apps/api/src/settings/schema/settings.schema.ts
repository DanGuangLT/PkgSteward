import { isFullyQualifiedPath, toPathPlatform } from '@/common/utils/path.util';
import type { PathPlatform } from '@/common/utils/path.util';
import {
  LOOPBACK_HOSTS,
  SETTINGS_FILE_KEYS,
} from '@/config/environment/env.validation';
import { parseScanRootPaths } from '@/config/environment/scan-roots';

export const SETTINGS_SCHEMA_VERSION = 1 as const;
export const MAX_SETTINGS_PLUGIN_ENTRIES = 100;
export const MAX_SETTINGS_PLUGIN_CONFIG_KEYS = 50;
export const MAX_SETTINGS_TRUSTED_REGISTRIES = 20;
export const MAX_SETTINGS_DESKTOP_KEYS = 50;
export const MAX_PLUGIN_CONFIG_STRING_LENGTH = 2048;
export const MAX_SCAN_DEPTH_LIMIT = 20;
export const MAX_TIMEOUT_MS = 86_400_000;

export const PLUGIN_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SERVER_PREFIX_OR_VERSION_REGEX = /^[a-zA-Z0-9_-]{1,32}$/;

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type SettingsThemeMode = (typeof THEME_MODES)[number];

export const THEME_PRESETS = [
  'default',
  'ocean',
  'emerald',
  'slate',
  'amber',
  'violet',
] as const;
export type SettingsThemePreset = (typeof THEME_PRESETS)[number];

export const BODY_FONT_FAMILIES = [
  'inter',
  'be-vietnam-pro',
  'plus-jakarta-sans',
  'roboto',
  'system',
] as const;
export type SettingsFontFamily = (typeof BODY_FONT_FAMILIES)[number];

export const MONO_FONT_FAMILIES = [
  'geist-mono',
  'jetbrains-mono',
  'fira-code',
  'system',
] as const;
export type SettingsMonoFontFamily = (typeof MONO_FONT_FAMILIES)[number];

export const FONT_SCALES = [85, 90, 95, 100, 105, 110, 115, 120] as const;
export type SettingsFontScale = (typeof FONT_SCALES)[number];

export const LINE_HEIGHT_MODES = ['tight', 'normal', 'relaxed'] as const;
export type SettingsLineHeight = (typeof LINE_HEIGHT_MODES)[number];

export const RADIUS_MODES = [
  'none',
  'sharp',
  'compact',
  'default',
  'rounded',
] as const;
export type SettingsRadius = (typeof RADIUS_MODES)[number];

export const DENSITY_MODES = ['compact', 'comfortable', 'spacious'] as const;
export type SettingsDensity = (typeof DENSITY_MODES)[number];

export const CONTENT_WIDTH_MODES = [
  'narrow',
  'standard',
  'wide',
  'full',
] as const;
export type SettingsContentWidth = (typeof CONTENT_WIDTH_MODES)[number];

export const NAVIGATION_LAYOUTS = ['topbar', 'sidebar'] as const;
export type SettingsNavigationLayout = (typeof NAVIGATION_LAYOUTS)[number];

export const REDUCED_MOTION_MODES = ['system', 'reduce', 'normal'] as const;
export type SettingsReducedMotion = (typeof REDUCED_MOTION_MODES)[number];

export const APP_LOCALES = ['vi', 'en'] as const;
export type SettingsLocale = (typeof APP_LOCALES)[number];

export const CONSOLE_SHELLS = ['cmd', 'powershell'] as const;
export type SettingsConsoleShell = (typeof CONSOLE_SHELLS)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type SettingsPageSize = (typeof PAGE_SIZES)[number];

export const DATE_FORMATS = ['relative', 'absolute', 'iso'] as const;
export type SettingsDateFormat = (typeof DATE_FORMATS)[number];

export const PLUGIN_SOURCES = ['builtin', 'local', 'npm'] as const;
export type PluginEntrySource = (typeof PLUGIN_SOURCES)[number];

export type PrimitiveConfigValue = string | number | boolean | null;

export interface IRuntimeSettings {
  scanRootPaths: string;
  maxScanDepth: number;
  scanTimeoutMs: number | null;
  npmCommandTimeoutMs: number | null;
}

export interface IServerSettings {
  mode: 'development' | 'production';
  host: '127.0.0.1' | 'localhost' | '::1';
  port: number;
  globalPrefix: string;
  version: string;
  listOriginCors: string;
  exportSwaggerApiJson: boolean;
}

export interface IAppearanceSettings {
  themeMode: SettingsThemeMode;
  themePreset: SettingsThemePreset;
  fontFamily: SettingsFontFamily;
  monoFontFamily: SettingsMonoFontFamily;
  fontScale: SettingsFontScale;
  lineHeight: SettingsLineHeight;
  radius: SettingsRadius;
  density: SettingsDensity;
  contentWidth: SettingsContentWidth;
  navigationLayout: SettingsNavigationLayout;
  sidebarCollapsed: boolean;
  reducedMotion: SettingsReducedMotion;
  highContrastBorders: boolean;
  showBreadcrumbs: boolean;
}

export interface IBehaviorSettings {
  locale: SettingsLocale;
  defaultConsoleShell: SettingsConsoleShell;
  defaultPageSize: SettingsPageSize;
  paginationEnabled: boolean;
  showPageSizeSelector: boolean;
  scrollToTopOnPageChange: boolean;
  autoRefreshOnFocus: boolean;
  confirmBeforeNavigation: boolean;
  dateFormat: SettingsDateFormat;
  showDesignSystemInNav: boolean;
  advancedMode: boolean;
}

export interface IPluginEntrySetting {
  enabled: boolean;
  version?: string;
  source?: PluginEntrySource;
  config: Record<string, PrimitiveConfigValue>;
}

export interface IPluginsSettings {
  enabled: boolean;
  directory: string | null;
  allowLocalPlugins: boolean;
  trustedRegistries: string[];
  removedPreinstalled: string[];
  entries: Record<string, IPluginEntrySetting>;
}

export interface ISettingsDocument {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  runtime: IRuntimeSettings;
  server: IServerSettings;
  appearance: IAppearanceSettings;
  behavior: IBehaviorSettings;
  plugins: IPluginsSettings;
  desktop: Record<string, PrimitiveConfigValue>;
}

export interface ISettingsOverrides {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  runtime?: Partial<IRuntimeSettings>;
  server?: Partial<IServerSettings>;
  appearance?: Partial<IAppearanceSettings>;
  behavior?: Partial<IBehaviorSettings>;
  plugins?: {
    enabled?: boolean;
    directory?: string | null;
    allowLocalPlugins?: boolean;
    trustedRegistries?: string[];
    removedPreinstalled?: string[];
    entries?: Record<string, IPluginEntrySetting>;
  };
  desktop?: Record<string, PrimitiveConfigValue>;
}

export const DEFAULT_RUNTIME_SETTINGS: Readonly<IRuntimeSettings> =
  Object.freeze({
    scanRootPaths: '*',
    maxScanDepth: 0,
    scanTimeoutMs: null,
    npmCommandTimeoutMs: null,
  });

export const DEFAULT_SERVER_SETTINGS: Readonly<IServerSettings> = Object.freeze(
  {
    mode: 'development',
    host: '127.0.0.1',
    port: 24681,
    globalPrefix: 'api',
    version: '1',
    listOriginCors: 'http://localhost:24680',
    exportSwaggerApiJson: true,
  },
);

export const DEFAULT_APPEARANCE_SETTINGS: Readonly<IAppearanceSettings> =
  Object.freeze({
    themeMode: 'system',
    themePreset: 'default',
    fontFamily: 'inter',
    monoFontFamily: 'geist-mono',
    fontScale: 100,
    lineHeight: 'normal',
    radius: 'default',
    density: 'comfortable',
    contentWidth: 'standard',
    navigationLayout: 'topbar',
    sidebarCollapsed: false,
    reducedMotion: 'system',
    highContrastBorders: false,
    showBreadcrumbs: false,
  });

export const DEFAULT_BEHAVIOR_SETTINGS: Readonly<IBehaviorSettings> =
  Object.freeze({
    locale: 'vi',
    defaultConsoleShell: 'cmd',
    defaultPageSize: 25,
    paginationEnabled: true,
    showPageSizeSelector: true,
    scrollToTopOnPageChange: true,
    autoRefreshOnFocus: true,
    confirmBeforeNavigation: true,
    dateFormat: 'relative',
    showDesignSystemInNav: true,
    advancedMode: false,
  });

export const DEFAULT_PLUGINS_SETTINGS: Readonly<IPluginsSettings> =
  Object.freeze({
    enabled: true,
    directory: null,
    allowLocalPlugins: true,
    trustedRegistries: [],
    removedPreinstalled: [],
    entries: {},
  });

export function createDefaultSettingsDocument(): ISettingsDocument {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    runtime: { ...DEFAULT_RUNTIME_SETTINGS },
    server: { ...DEFAULT_SERVER_SETTINGS },
    appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
    behavior: { ...DEFAULT_BEHAVIOR_SETTINGS },
    plugins: {
      ...DEFAULT_PLUGINS_SETTINGS,
      trustedRegistries: [],
      removedPreinstalled: [],
      entries: {},
    },
    desktop: {},
  };
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const TOP_LEVEL_SECTIONS = new Set([
  'schemaVersion',
  'runtime',
  'server',
  'appearance',
  'behavior',
  'plugins',
  'desktop',
]);
const RUNTIME_KEYS = new Set([
  'scanRootPaths',
  'maxScanDepth',
  'scanTimeoutMs',
  'npmCommandTimeoutMs',
]);
const SERVER_KEYS = new Set([
  'mode',
  'host',
  'port',
  'globalPrefix',
  'version',
  'listOriginCors',
  'exportSwaggerApiJson',
]);
const APPEARANCE_KEYS = new Set([
  'themeMode',
  'themePreset',
  'fontFamily',
  'monoFontFamily',
  'fontScale',
  'lineHeight',
  'radius',
  'density',
  'contentWidth',
  'navigationLayout',
  'sidebarCollapsed',
  'reducedMotion',
  'highContrastBorders',
  'showBreadcrumbs',
]);
const BEHAVIOR_KEYS = new Set([
  'locale',
  'defaultConsoleShell',
  'defaultPageSize',
  'paginationEnabled',
  'showPageSizeSelector',
  'scrollToTopOnPageChange',
  'autoRefreshOnFocus',
  'confirmBeforeNavigation',
  'dateFormat',
  'showDesignSystemInNav',
  'advancedMode',
]);
const PLUGINS_KEYS = new Set([
  'enabled',
  'directory',
  'allowLocalPlugins',
  'trustedRegistries',
  'removedPreinstalled',
  'entries',
]);
const PLUGIN_ENTRY_KEYS = new Set(['enabled', 'version', 'source', 'config']);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatContext = (filePath?: string) =>
  filePath ? `Settings file ${filePath}: ` : '';

const assertSafeObjectKeys = (
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string> | null,
  scope: string,
  filePath?: string,
): string[] => {
  const ctx = formatContext(filePath);
  const keys = Object.getOwnPropertyNames(obj);
  for (const key of keys) {
    if (key === 'PKGSTEWARD_DATA_DIR') {
      throw new Error(
        `${ctx}PKGSTEWARD_DATA_DIR cannot be set in settings.json (use the environment variable)`,
      );
    }
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`${ctx}forbidden key "${key}" in ${scope}`);
    }
    if (allowed !== null && !allowed.has(key)) {
      throw new Error(`${ctx}unknown key "${key}" in ${scope}`);
    }
  }
  return keys;
};

const assertEnum = <T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  filePath?: string,
): T => {
  if (!allowed.includes(value as T)) {
    throw new Error(
      `${formatContext(filePath)}"${field}" must be one of: ${allowed.join(', ')}`,
    );
  }
  return value as T;
};

const assertBoolean = (
  value: unknown,
  field: string,
  filePath?: string,
): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`${formatContext(filePath)}"${field}" must be a boolean`);
  }
  return value;
};

const assertTimeout = (
  value: unknown,
  field: string,
  filePath?: string,
): number | null => {
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1000 ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `${formatContext(filePath)}"${field}" must be null (no time limit) or an integer between 1000 and ${MAX_TIMEOUT_MS}`,
    );
  }
  return value;
};

const normalizeOriginToken = (
  raw: string,
  field: string,
  filePath?: string,
) => {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'null') {
    throw new Error(
      `${formatContext(filePath)}"${field}" contains invalid origin "${raw}"`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `${formatContext(filePath)}"${field}" contains invalid origin URL "${raw}"`,
    );
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new Error(
      `${formatContext(filePath)}"${field}" origin must be scheme://host[:port] without path or credentials ("${raw}")`,
    );
  }
  return parsed.origin;
};

export const validateCorsOriginList = (
  value: unknown,
  field = 'server.listOriginCors',
  filePath?: string,
): string => {
  if (typeof value !== 'string') {
    throw new Error(`${formatContext(filePath)}"${field}" must be a string`);
  }
  const tokens = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const normalized = tokens.map((token) =>
    normalizeOriginToken(token, field, filePath),
  );
  return [...new Set(normalized)].join(', ');
};

const parsePrimitiveRecord = (
  raw: unknown,
  scope: string,
  maxKeys: number,
  filePath?: string,
): Record<string, PrimitiveConfigValue> => {
  if (!isPlainRecord(raw)) {
    throw new Error(`${formatContext(filePath)}"${scope}" must be an object`);
  }
  const keys = assertSafeObjectKeys(raw, null, scope, filePath);
  if (keys.length > maxKeys) {
    throw new Error(
      `${formatContext(filePath)}"${scope}" exceeds maximum of ${maxKeys} keys`,
    );
  }
  const safeOut: Record<string, PrimitiveConfigValue> = {};
  for (const key of keys) {
    if (key.trim() === '' || key.length > 64) {
      throw new Error(
        `${formatContext(filePath)}invalid key "${key}" in ${scope}`,
      );
    }
    const val = raw[key];
    if (
      val !== null &&
      typeof val !== 'string' &&
      typeof val !== 'boolean' &&
      !(typeof val === 'number' && Number.isFinite(val))
    ) {
      throw new Error(
        `${formatContext(filePath)}"${scope}.${key}" must be a string, finite number, boolean, or null`,
      );
    }
    if (
      typeof val === 'string' &&
      val.length > MAX_PLUGIN_CONFIG_STRING_LENGTH
    ) {
      throw new Error(
        `${formatContext(filePath)}"${scope}.${key}" exceeds ${MAX_PLUGIN_CONFIG_STRING_LENGTH} characters`,
      );
    }
    safeOut[key] = val;
  }
  return safeOut;
};

const parseRuntimeSection = (
  raw: unknown,
  platform: PathPlatform,
  filePath?: string,
): Partial<IRuntimeSettings> => {
  if (!isPlainRecord(raw)) {
    throw new Error(`${formatContext(filePath)}"runtime" must be an object`);
  }
  const keys = assertSafeObjectKeys(raw, RUNTIME_KEYS, 'runtime', filePath);
  const out: Partial<IRuntimeSettings> = {};
  for (const key of keys) {
    const value = raw[key];
    if (key === 'scanRootPaths') {
      if (typeof value !== 'string') {
        throw new Error(
          `${formatContext(filePath)}"runtime.scanRootPaths" must be a string`,
        );
      }
      const parsed = parseScanRootPaths(value, platform);
      out.scanRootPaths =
        parsed.kind === 'all-fixed-drives' ? '*' : parsed.paths.join(', ');
    } else if (key === 'maxScanDepth') {
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > MAX_SCAN_DEPTH_LIMIT
      ) {
        throw new Error(
          `${formatContext(filePath)}"runtime.maxScanDepth" must be an integer between 0 and ${MAX_SCAN_DEPTH_LIMIT}`,
        );
      }
      out.maxScanDepth = value;
    } else if (key === 'scanTimeoutMs') {
      out.scanTimeoutMs = assertTimeout(
        value,
        'runtime.scanTimeoutMs',
        filePath,
      );
    } else if (key === 'npmCommandTimeoutMs') {
      out.npmCommandTimeoutMs = assertTimeout(
        value,
        'runtime.npmCommandTimeoutMs',
        filePath,
      );
    }
  }
  return out;
};

const parseServerSection = (
  raw: unknown,
  filePath?: string,
): Partial<IServerSettings> => {
  if (!isPlainRecord(raw)) {
    throw new Error(`${formatContext(filePath)}"server" must be an object`);
  }
  const keys = assertSafeObjectKeys(raw, SERVER_KEYS, 'server', filePath);
  const out: Partial<IServerSettings> = {};
  for (const key of keys) {
    const value = raw[key];
    if (key === 'mode') {
      out.mode = assertEnum(
        value,
        ['development', 'production'] as const,
        'server.mode',
        filePath,
      );
    } else if (key === 'host') {
      if (typeof value !== 'string') {
        throw new Error(
          `${formatContext(filePath)}"server.host" must be one of: ${LOOPBACK_HOSTS.join(', ')}`,
        );
      }
      const normalized = value.trim().toLowerCase();
      out.host = assertEnum(
        normalized,
        ['127.0.0.1', 'localhost', '::1'] as const,
        'server.host',
        filePath,
      );
    } else if (key === 'port') {
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > 65535
      ) {
        throw new Error(
          `${formatContext(filePath)}"server.port" must be an integer between 1 and 65535`,
        );
      }
      out.port = value;
    } else if (key === 'globalPrefix') {
      if (
        typeof value !== 'string' ||
        !SERVER_PREFIX_OR_VERSION_REGEX.test(value.trim())
      ) {
        throw new Error(
          `${formatContext(filePath)}"server.globalPrefix" must match ${SERVER_PREFIX_OR_VERSION_REGEX.source}`,
        );
      }
      out.globalPrefix = value.trim();
    } else if (key === 'version') {
      if (
        typeof value !== 'string' ||
        !SERVER_PREFIX_OR_VERSION_REGEX.test(value.trim())
      ) {
        throw new Error(
          `${formatContext(filePath)}"server.version" must match ${SERVER_PREFIX_OR_VERSION_REGEX.source}`,
        );
      }
      out.version = value.trim();
    } else if (key === 'listOriginCors') {
      out.listOriginCors = validateCorsOriginList(
        value,
        'server.listOriginCors',
        filePath,
      );
    } else if (key === 'exportSwaggerApiJson') {
      out.exportSwaggerApiJson = assertBoolean(
        value,
        'server.exportSwaggerApiJson',
        filePath,
      );
    }
  }
  return out;
};

const parseAppearanceSection = (
  raw: unknown,
  filePath?: string,
): Partial<IAppearanceSettings> => {
  if (!isPlainRecord(raw)) {
    throw new Error(`${formatContext(filePath)}"appearance" must be an object`);
  }
  const keys = assertSafeObjectKeys(
    raw,
    APPEARANCE_KEYS,
    'appearance',
    filePath,
  );
  const out: Partial<IAppearanceSettings> = {};
  for (const key of keys) {
    const value = raw[key];
    switch (key) {
      case 'themeMode':
        out.themeMode = assertEnum(
          value,
          THEME_MODES,
          'appearance.themeMode',
          filePath,
        );
        break;
      case 'themePreset':
        out.themePreset = assertEnum(
          value,
          THEME_PRESETS,
          'appearance.themePreset',
          filePath,
        );
        break;
      case 'fontFamily':
        out.fontFamily = assertEnum(
          value,
          BODY_FONT_FAMILIES,
          'appearance.fontFamily',
          filePath,
        );
        break;
      case 'monoFontFamily':
        out.monoFontFamily = assertEnum(
          value,
          MONO_FONT_FAMILIES,
          'appearance.monoFontFamily',
          filePath,
        );
        break;
      case 'fontScale':
        out.fontScale = assertEnum(
          value,
          FONT_SCALES,
          'appearance.fontScale',
          filePath,
        );
        break;
      case 'lineHeight':
        out.lineHeight = assertEnum(
          value,
          LINE_HEIGHT_MODES,
          'appearance.lineHeight',
          filePath,
        );
        break;
      case 'radius':
        out.radius = assertEnum(
          value,
          RADIUS_MODES,
          'appearance.radius',
          filePath,
        );
        break;
      case 'density':
        out.density = assertEnum(
          value,
          DENSITY_MODES,
          'appearance.density',
          filePath,
        );
        break;
      case 'contentWidth':
        out.contentWidth = assertEnum(
          value,
          CONTENT_WIDTH_MODES,
          'appearance.contentWidth',
          filePath,
        );
        break;
      case 'navigationLayout':
        out.navigationLayout = assertEnum(
          value,
          NAVIGATION_LAYOUTS,
          'appearance.navigationLayout',
          filePath,
        );
        break;
      case 'sidebarCollapsed':
        out.sidebarCollapsed = assertBoolean(
          value,
          'appearance.sidebarCollapsed',
          filePath,
        );
        break;
      case 'reducedMotion':
        out.reducedMotion = assertEnum(
          value,
          REDUCED_MOTION_MODES,
          'appearance.reducedMotion',
          filePath,
        );
        break;
      case 'highContrastBorders':
        out.highContrastBorders = assertBoolean(
          value,
          'appearance.highContrastBorders',
          filePath,
        );
        break;
      case 'showBreadcrumbs':
        out.showBreadcrumbs = assertBoolean(
          value,
          'appearance.showBreadcrumbs',
          filePath,
        );
        break;
    }
  }
  return out;
};

const parseBehaviorSection = (
  raw: unknown,
  filePath?: string,
): Partial<IBehaviorSettings> => {
  if (!isPlainRecord(raw)) {
    throw new Error(`${formatContext(filePath)}"behavior" must be an object`);
  }
  const keys = assertSafeObjectKeys(raw, BEHAVIOR_KEYS, 'behavior', filePath);
  const out: Partial<IBehaviorSettings> = {};
  for (const key of keys) {
    const value = raw[key];
    switch (key) {
      case 'locale':
        out.locale = assertEnum(
          value,
          APP_LOCALES,
          'behavior.locale',
          filePath,
        );
        break;
      case 'defaultConsoleShell':
        out.defaultConsoleShell = assertEnum(
          value,
          CONSOLE_SHELLS,
          'behavior.defaultConsoleShell',
          filePath,
        );
        break;
      case 'defaultPageSize':
        out.defaultPageSize = assertEnum(
          value,
          PAGE_SIZES,
          'behavior.defaultPageSize',
          filePath,
        );
        break;
      case 'paginationEnabled':
        out.paginationEnabled = assertBoolean(
          value,
          'behavior.paginationEnabled',
          filePath,
        );
        break;
      case 'showPageSizeSelector':
        out.showPageSizeSelector = assertBoolean(
          value,
          'behavior.showPageSizeSelector',
          filePath,
        );
        break;
      case 'scrollToTopOnPageChange':
        out.scrollToTopOnPageChange = assertBoolean(
          value,
          'behavior.scrollToTopOnPageChange',
          filePath,
        );
        break;
      case 'autoRefreshOnFocus':
        out.autoRefreshOnFocus = assertBoolean(
          value,
          'behavior.autoRefreshOnFocus',
          filePath,
        );
        break;
      case 'confirmBeforeNavigation':
        out.confirmBeforeNavigation = assertBoolean(
          value,
          'behavior.confirmBeforeNavigation',
          filePath,
        );
        break;
      case 'dateFormat':
        out.dateFormat = assertEnum(
          value,
          DATE_FORMATS,
          'behavior.dateFormat',
          filePath,
        );
        break;
      case 'showDesignSystemInNav':
        out.showDesignSystemInNav = assertBoolean(
          value,
          'behavior.showDesignSystemInNav',
          filePath,
        );
        break;
      case 'advancedMode':
        out.advancedMode = assertBoolean(
          value,
          'behavior.advancedMode',
          filePath,
        );
        break;
    }
  }
  return out;
};

const parsePluginsSection = (
  raw: unknown,
  platform: PathPlatform,
  filePath?: string,
): ISettingsOverrides['plugins'] => {
  if (!isPlainRecord(raw)) {
    throw new Error(`${formatContext(filePath)}"plugins" must be an object`);
  }
  const keys = assertSafeObjectKeys(raw, PLUGINS_KEYS, 'plugins', filePath);
  const out: NonNullable<ISettingsOverrides['plugins']> = {};
  for (const key of keys) {
    const value = raw[key];
    if (key === 'enabled') {
      out.enabled = assertBoolean(value, 'plugins.enabled', filePath);
    } else if (key === 'allowLocalPlugins') {
      out.allowLocalPlugins = assertBoolean(
        value,
        'plugins.allowLocalPlugins',
        filePath,
      );
    } else if (key === 'directory') {
      if (
        value === null ||
        (typeof value === 'string' && value.trim() === '')
      ) {
        out.directory = null;
      } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.includes('\0') || trimmed.split(/[\\/]+/).includes('..')) {
          throw new Error(
            `${formatContext(filePath)}"plugins.directory" must not contain path traversal segments`,
          );
        }
        if (!isFullyQualifiedPath(trimmed, platform)) {
          throw new Error(
            `${formatContext(filePath)}"plugins.directory" must be an absolute path`,
          );
        }
        out.directory = trimmed;
      } else {
        throw new Error(
          `${formatContext(filePath)}"plugins.directory" must be an absolute path string or null`,
        );
      }
    } else if (key === 'removedPreinstalled') {
      if (!Array.isArray(value) || value.length > 50) {
        throw new Error(
          `${formatContext(filePath)}"plugins.removedPreinstalled" must be an array (<= 50 items)`,
        );
      }
      out.removedPreinstalled = [
        ...new Set(
          value.map((item) => {
            if (typeof item !== 'string' || !PLUGIN_ID_REGEX.test(item)) {
              throw new Error(
                `${formatContext(filePath)}invalid plugin id "${String(item)}" in plugins.removedPreinstalled`,
              );
            }
            return item;
          }),
        ),
      ];
    } else if (key === 'trustedRegistries') {
      if (!Array.isArray(value)) {
        throw new Error(
          `${formatContext(filePath)}"plugins.trustedRegistries" must be an array`,
        );
      }
      if (value.length > MAX_SETTINGS_TRUSTED_REGISTRIES) {
        throw new Error(
          `${formatContext(filePath)}"plugins.trustedRegistries" exceeds maximum of ${MAX_SETTINGS_TRUSTED_REGISTRIES}`,
        );
      }
      out.trustedRegistries = [
        ...new Set(
          value.map((item) => {
            if (typeof item !== 'string') {
              throw new Error(
                `${formatContext(filePath)}"plugins.trustedRegistries" items must be strings`,
              );
            }
            let url: URL;
            try {
              url = new URL(item.trim());
            } catch {
              throw new Error(
                `${formatContext(filePath)}"plugins.trustedRegistries" contains invalid URL "${item}"`,
              );
            }
            const isLocalHttp =
              url.protocol === 'http:' &&
              (url.hostname === 'localhost' ||
                url.hostname === '127.0.0.1' ||
                url.hostname === '[::1]');
            if (
              (url.protocol !== 'https:' && !isLocalHttp) ||
              url.username !== '' ||
              url.password !== '' ||
              url.search !== '' ||
              url.hash !== '' ||
              (url.pathname !== '/' && url.pathname !== '')
            ) {
              throw new Error(
                `${formatContext(filePath)}"plugins.trustedRegistries" must use https:// (or loopback http://) origin URLs`,
              );
            }
            return url.origin;
          }),
        ),
      ];
    } else if (key === 'entries') {
      if (!isPlainRecord(value)) {
        throw new Error(
          `${formatContext(filePath)}"plugins.entries" must be an object`,
        );
      }
      const entryIds = assertSafeObjectKeys(
        value,
        null,
        'plugins.entries',
        filePath,
      );
      if (entryIds.length > MAX_SETTINGS_PLUGIN_ENTRIES) {
        throw new Error(
          `${formatContext(filePath)}"plugins.entries" exceeds maximum of ${MAX_SETTINGS_PLUGIN_ENTRIES}`,
        );
      }
      const entries: Record<string, IPluginEntrySetting> = {};
      for (const id of entryIds) {
        if (!PLUGIN_ID_REGEX.test(id)) {
          throw new Error(
            `${formatContext(filePath)}invalid plugin id "${id}" in plugins.entries`,
          );
        }
        const rawEntry = value[id];
        if (!isPlainRecord(rawEntry)) {
          throw new Error(
            `${formatContext(filePath)}"plugins.entries.${id}" must be an object`,
          );
        }
        assertSafeObjectKeys(
          rawEntry,
          PLUGIN_ENTRY_KEYS,
          `plugins.entries.${id}`,
          filePath,
        );
        const enabled = assertBoolean(
          rawEntry.enabled,
          `plugins.entries.${id}.enabled`,
          filePath,
        );
        const entry: IPluginEntrySetting = {
          enabled,
          config:
            rawEntry.config === undefined
              ? {}
              : parsePrimitiveRecord(
                  rawEntry.config,
                  `plugins.entries.${id}.config`,
                  MAX_SETTINGS_PLUGIN_CONFIG_KEYS,
                  filePath,
                ),
        };
        if (rawEntry.version !== undefined) {
          if (
            typeof rawEntry.version !== 'string' ||
            rawEntry.version.trim() === '' ||
            rawEntry.version.length > 64
          ) {
            throw new Error(
              `${formatContext(filePath)}"plugins.entries.${id}.version" must be a non-empty string (<= 64 chars)`,
            );
          }
          entry.version = rawEntry.version.trim();
        }
        if (rawEntry.source !== undefined) {
          entry.source = assertEnum(
            rawEntry.source,
            PLUGIN_SOURCES,
            `plugins.entries.${id}.source`,
            filePath,
          );
        }
        entries[id] = entry;
      }
      out.entries = entries;
    }
  }
  return out;
};

export interface IParseSettingsOptions {
  platform?: PathPlatform;
  filePath?: string;
}

export function parseStructuredSettingsOverrides(
  raw: unknown,
  options: IParseSettingsOptions = {},
): ISettingsOverrides {
  const platform = options.platform ?? toPathPlatform();
  const filePath = options.filePath;
  if (!isPlainRecord(raw)) {
    throw new Error(
      `${formatContext(filePath)}structured settings must contain a JSON object`,
    );
  }
  const topKeys = assertSafeObjectKeys(
    raw,
    TOP_LEVEL_SECTIONS,
    'settings',
    filePath,
  );
  if (raw.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    throw new Error(
      `${formatContext(filePath)}unsupported schemaVersion "${String(raw.schemaVersion)}" (expected ${SETTINGS_SCHEMA_VERSION})`,
    );
  }

  const out: ISettingsOverrides = { schemaVersion: SETTINGS_SCHEMA_VERSION };
  for (const key of topKeys) {
    if (key === 'runtime' && raw.runtime !== undefined) {
      out.runtime = parseRuntimeSection(raw.runtime, platform, filePath);
    } else if (key === 'server' && raw.server !== undefined) {
      out.server = parseServerSection(raw.server, filePath);
    } else if (key === 'appearance' && raw.appearance !== undefined) {
      out.appearance = parseAppearanceSection(raw.appearance, filePath);
    } else if (key === 'behavior' && raw.behavior !== undefined) {
      out.behavior = parseBehaviorSection(raw.behavior, filePath);
    } else if (key === 'plugins' && raw.plugins !== undefined) {
      out.plugins = parsePluginsSection(raw.plugins, platform, filePath);
    } else if (key === 'desktop' && raw.desktop !== undefined) {
      out.desktop = parsePrimitiveRecord(
        raw.desktop,
        'desktop',
        MAX_SETTINGS_DESKTOP_KEYS,
        filePath,
      );
    }
  }
  return out;
}

export function applyOverridesToDocument(
  base: ISettingsDocument,
  overrides: ISettingsOverrides,
): ISettingsDocument {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    runtime: { ...base.runtime, ...overrides.runtime },
    server: { ...base.server, ...overrides.server },
    appearance: { ...base.appearance, ...overrides.appearance },
    behavior: { ...base.behavior, ...overrides.behavior },
    plugins: {
      enabled: overrides.plugins?.enabled ?? base.plugins.enabled,
      directory:
        overrides.plugins?.directory !== undefined
          ? overrides.plugins.directory
          : base.plugins.directory,
      allowLocalPlugins:
        overrides.plugins?.allowLocalPlugins ?? base.plugins.allowLocalPlugins,
      trustedRegistries:
        overrides.plugins?.trustedRegistries !== undefined
          ? [...overrides.plugins.trustedRegistries]
          : [...base.plugins.trustedRegistries],
      removedPreinstalled:
        overrides.plugins?.removedPreinstalled !== undefined
          ? [...overrides.plugins.removedPreinstalled]
          : [...base.plugins.removedPreinstalled],
      entries:
        overrides.plugins?.entries !== undefined
          ? structuredClone(overrides.plugins.entries)
          : structuredClone(base.plugins.entries),
    },
    desktop:
      overrides.desktop !== undefined
        ? { ...overrides.desktop }
        : { ...base.desktop },
  };
}

export function parseStructuredSettingsDocument(
  raw: unknown,
  options: IParseSettingsOptions = {},
): ISettingsDocument {
  const overrides = parseStructuredSettingsOverrides(raw, options);
  return applyOverridesToDocument(createDefaultSettingsDocument(), overrides);
}

export function projectStructuredSettingsToEnvMap(
  overrides: ISettingsOverrides,
): Record<string, unknown> {
  const envMap: Record<string, unknown> = {};
  if (overrides.runtime) {
    const r = overrides.runtime;
    if (r.scanRootPaths !== undefined) {
      envMap.SCAN_ROOT_PATHS = r.scanRootPaths;
    }
    if (r.maxScanDepth !== undefined) {
      envMap.MAX_SCAN_DEPTH = r.maxScanDepth;
    }
    if (r.scanTimeoutMs !== undefined) {
      envMap.SCAN_TIMEOUT_MS = r.scanTimeoutMs === null ? '' : r.scanTimeoutMs;
    }
    if (r.npmCommandTimeoutMs !== undefined) {
      envMap.NPM_COMMAND_TIMEOUT_MS =
        r.npmCommandTimeoutMs === null ? '' : r.npmCommandTimeoutMs;
    }
  }
  if (overrides.server) {
    const s = overrides.server;
    if (s.mode !== undefined) envMap.MODE = s.mode;
    if (s.host !== undefined) envMap.HOST = s.host;
    if (s.port !== undefined) envMap.PORT = s.port;
    if (s.globalPrefix !== undefined) envMap.GLOBAL_PREFIX = s.globalPrefix;
    if (s.version !== undefined) envMap.VERSION = s.version;
    if (s.listOriginCors !== undefined) {
      envMap.LIST_ORIGIN_CORS = s.listOriginCors;
    }
    if (s.exportSwaggerApiJson !== undefined) {
      envMap.EXPORT_SWAGGER_API_JSON = s.exportSwaggerApiJson;
    }
  }
  return envMap;
}

export function validateLegacyFlatRecord(
  raw: unknown,
  filePath?: string,
): Record<string, unknown> {
  if (!isPlainRecord(raw)) {
    throw new Error(
      `Settings file ${filePath ?? ''} must contain a flat JSON object`.trim(),
    );
  }
  const ctx = formatContext(filePath);
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'PKGSTEWARD_DATA_DIR') {
      throw new Error(
        `${ctx}PKGSTEWARD_DATA_DIR cannot be set in settings.json (use the environment variable)`,
      );
    }
    if (!SETTINGS_FILE_KEYS.includes(key)) {
      throw new Error(
        `${ctx}unknown key "${key}" (allowed: ${SETTINGS_FILE_KEYS.join(', ')})`,
      );
    }
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`${ctx}"${key}" must be a string, number or boolean`);
    }
  }
  return { ...raw };
}

const parseLegacyIntOrNull = (
  value: unknown,
  field: string,
  filePath?: string,
): number | null => {
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${formatContext(filePath)}"${field}" must be an integer`);
  }
  return parsed;
};

const parseLegacyBoolean = (
  value: unknown,
  field: string,
  filePath?: string,
): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`${formatContext(filePath)}"${field}" must be a boolean`);
};

export function migrateLegacyFlatSettings(
  raw: Record<string, unknown>,
  options: IParseSettingsOptions = {},
): ISettingsOverrides {
  const flat = validateLegacyFlatRecord(raw, options.filePath);
  const runtimeRaw: Record<string, unknown> = {};
  const serverRaw: Record<string, unknown> = {};

  if ('SCAN_ROOT_PATHS' in flat)
    runtimeRaw.scanRootPaths = flat.SCAN_ROOT_PATHS;
  if ('MAX_SCAN_DEPTH' in flat) {
    runtimeRaw.maxScanDepth = parseLegacyIntOrNull(
      flat.MAX_SCAN_DEPTH,
      'MAX_SCAN_DEPTH',
      options.filePath,
    );
  }
  if ('SCAN_TIMEOUT_MS' in flat) {
    runtimeRaw.scanTimeoutMs = parseLegacyIntOrNull(
      flat.SCAN_TIMEOUT_MS,
      'SCAN_TIMEOUT_MS',
      options.filePath,
    );
  }
  if ('NPM_COMMAND_TIMEOUT_MS' in flat) {
    runtimeRaw.npmCommandTimeoutMs = parseLegacyIntOrNull(
      flat.NPM_COMMAND_TIMEOUT_MS,
      'NPM_COMMAND_TIMEOUT_MS',
      options.filePath,
    );
  }

  if ('MODE' in flat) serverRaw.mode = flat.MODE;
  if ('HOST' in flat) serverRaw.host = flat.HOST;
  if ('PORT' in flat) {
    serverRaw.port = parseLegacyIntOrNull(flat.PORT, 'PORT', options.filePath);
  }
  if ('GLOBAL_PREFIX' in flat) serverRaw.globalPrefix = flat.GLOBAL_PREFIX;
  if ('VERSION' in flat) serverRaw.version = flat.VERSION;
  if ('LIST_ORIGIN_CORS' in flat) {
    serverRaw.listOriginCors = flat.LIST_ORIGIN_CORS;
  }
  if ('EXPORT_SWAGGER_API_JSON' in flat) {
    serverRaw.exportSwaggerApiJson = parseLegacyBoolean(
      flat.EXPORT_SWAGGER_API_JSON,
      'EXPORT_SWAGGER_API_JSON',
      options.filePath,
    );
  }

  return parseStructuredSettingsOverrides(
    {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      ...(Object.keys(runtimeRaw).length > 0 ? { runtime: runtimeRaw } : {}),
      ...(Object.keys(serverRaw).length > 0 ? { server: serverRaw } : {}),
    },
    options,
  );
}
