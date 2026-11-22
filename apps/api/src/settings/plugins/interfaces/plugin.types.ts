export const PLUGIN_API_VERSION = 1 as const;
export const MAX_PLUGIN_MANIFEST_BYTES = 64 * 1024;
export const MAX_DISCOVERED_PLUGINS = 100;
export const PLUGIN_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const PLUGIN_MANIFEST_FILENAMES = [
  'manifest.json',
  'package.json',
  'project.json',
  'pkgsteward.plugin.json',
] as const;

export type PluginManifestFormat = (typeof PLUGIN_MANIFEST_FILENAMES)[number];

export const PLUGIN_CAPABILITIES = [
  'theme-preset',
  'live-wallpaper',
  'project-analyzer',
  'cleanup-rule',
  'dashboard-widget',
  'desktop-bridge',
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export type PluginEntryKind =
  | 'none'
  | 'builtin-wallpaper'
  | 'web-sandbox'
  | 'media-image'
  | 'media-video'
  | 'css-theme';

export interface IPluginEntryPoint {
  kind: PluginEntryKind;
  file: string | null;
}

export interface IPluginOrigin {
  kind: 'preinstalled' | 'file' | 'url' | 'local';
  sourceUrl: string | null;
  installedAt: string | null;
}

export interface IPluginSettingFieldSchema {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  defaultValue: string | number | boolean | null;
  description?: string;
}

export interface IPluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  format?: PluginManifestFormat;
  entry?: IPluginEntryPoint;
  description?: string;
  author?: string;
  homepage?: string;
  capabilities: PluginCapability[];
  minAppVersion?: string;
  settingsSchema: IPluginSettingFieldSchema[];
}

export interface IDiscoveredPlugin {
  id: string;
  name: string;
  version: string;
  apiVersion: typeof PLUGIN_API_VERSION;
  format: PluginManifestFormat;
  entry: IPluginEntryPoint;
  description: string | null;
  author: string | null;
  homepage: string | null;
  capabilities: PluginCapability[];
  minAppVersion: string | null;
  manifestPath: string;
  source: 'local';
  preinstalled: boolean;
  removable: boolean;
  origin: IPluginOrigin;
  enabled: boolean;
  config: Record<string, string | number | boolean | null>;
  settingsSchema: IPluginSettingFieldSchema[];
}

export interface IInvalidPluginManifest {
  directoryName: string;
  manifestPath: string;
  error: string;
}

export interface IPluginExtensionPoint {
  capability: PluginCapability;
  apiVersion: typeof PLUGIN_API_VERSION;
  status: 'planned' | 'schema-ready';
}

export interface IPluginsCatalog {
  apiVersion: typeof PLUGIN_API_VERSION;
  runtimeMode: 'sandboxed-web';
  pluginsEnabled: boolean;
  allowLocalPlugins: boolean;
  preinstalledAvailable: boolean;
  pluginsDir: string;
  extensionPoints: IPluginExtensionPoint[];
  discovered: IDiscoveredPlugin[];
  invalid: IInvalidPluginManifest[];
}
