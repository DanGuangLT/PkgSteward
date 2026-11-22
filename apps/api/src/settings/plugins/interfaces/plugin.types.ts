export const PLUGIN_API_VERSION = 1 as const;
export const MAX_PLUGIN_MANIFEST_BYTES = 64 * 1024;
export const MAX_DISCOVERED_PLUGINS = 100;
export const PLUGIN_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const PLUGIN_CAPABILITIES = [
  'theme-preset',
  'project-analyzer',
  'cleanup-rule',
  'dashboard-widget',
  'desktop-bridge',
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

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
  description: string | null;
  author: string | null;
  homepage: string | null;
  capabilities: PluginCapability[];
  minAppVersion: string | null;
  manifestPath: string;
  source: 'local';
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
  runtimeMode: 'manifest-only';
  pluginsEnabled: boolean;
  allowLocalPlugins: boolean;
  pluginsDir: string;
  extensionPoints: IPluginExtensionPoint[];
  discovered: IDiscoveredPlugin[];
  invalid: IInvalidPluginManifest[];
}
