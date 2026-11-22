import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IPluginManifest } from '@/settings/plugins/interfaces/plugin.types';
import { PLUGIN_API_VERSION } from '@/settings/plugins/interfaces/plugin.types';

export const DEFAULT_WALLPAPER_PLUGIN_ID = 'wallpaper-engine';

export const WALLPAPER_INSTALL_MARKER_FILE = '.pkgsteward-install.json';

export function buildPreinstalledWallpaperManifest(): IPluginManifest {
  return {
    id: DEFAULT_WALLPAPER_PLUGIN_ID,
    name: 'Live Wallpaper Engine',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    format: 'manifest.json',
    entry: { kind: 'builtin-wallpaper', file: null },
    description:
      'Built-in animated canvas shaders (Aurora, Particles, Waves, Matrix, Mesh) and custom image/video wallpaper engine.',
    author: 'PkgSteward',
    capabilities: ['live-wallpaper'],
    settingsSchema: [
      {
        key: 'mode',
        label: 'Wallpaper Mode',
        type: 'string',
        defaultValue: 'off',
        description:
          'off, aurora, particles, waves, matrix, mesh, image, or video',
      },
      {
        key: 'mediaUrl',
        label: 'Image / Video URL',
        type: 'string',
        defaultValue: '',
      },
      {
        key: 'mediaAsset',
        label: 'Uploaded Local Media Asset',
        type: 'string',
        defaultValue: '',
      },
      {
        key: 'blurPx',
        label: 'Backdrop Blur (px)',
        type: 'number',
        defaultValue: 8,
      },
      {
        key: 'dimOpacity',
        label: 'Background Dim (%)',
        type: 'number',
        defaultValue: 30,
      },
      {
        key: 'surfaceOpacity',
        label: 'Card Surface Opacity (%)',
        type: 'number',
        defaultValue: 86,
      },
      {
        key: 'speed',
        label: 'Animation Speed (%)',
        type: 'number',
        defaultValue: 100,
      },
      {
        key: 'pauseWhenHidden',
        label: 'Pause When Window Hidden',
        type: 'boolean',
        defaultValue: true,
      },
    ],
  };
}

export async function ensurePreinstalledWallpaperPlugin(
  pluginsDir: string,
  removedPreinstalled: readonly string[],
): Promise<void> {
  if (removedPreinstalled.includes(DEFAULT_WALLPAPER_PLUGIN_ID)) {
    return;
  }

  const pluginFolder = join(pluginsDir, DEFAULT_WALLPAPER_PLUGIN_ID);
  const manifestPath = join(pluginFolder, 'manifest.json');
  const markerPath = join(pluginFolder, WALLPAPER_INSTALL_MARKER_FILE);

  try {
    await stat(manifestPath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return;
    }
  }

  await mkdir(pluginFolder, { recursive: true });
  const manifestPayload = {
    $schema: 'pkgsteward-plugin-v1',
    id: DEFAULT_WALLPAPER_PLUGIN_ID,
    name: 'Live Wallpaper Engine',
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    description:
      'Built-in animated canvas shaders (Aurora, Particles, Waves, Matrix, Mesh) and custom image/video wallpaper engine.',
    author: 'PkgSteward',
    capabilities: ['live-wallpaper'],
    entry: { kind: 'builtin-wallpaper', file: null },
    settingsSchema: buildPreinstalledWallpaperManifest().settingsSchema,
  };
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifestPayload, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    markerPath,
    `${JSON.stringify(
      {
        preinstalled: true,
        sourceKind: 'preinstalled',
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
