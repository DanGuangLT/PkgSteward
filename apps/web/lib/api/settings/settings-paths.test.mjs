import { test } from "node:test"
import assert from "node:assert/strict"
import { pluginAssetPath, pluginSandboxDocumentPath, settingsPaths } from "./settings-paths.ts"

test("settingsPaths defines exact canonical backend/proxy suffixes", () => {
  assert.deepEqual(settingsPaths, {
    root: "/settings",
    preferences: "/settings/preferences",
    preview: "/settings/preview",
    export: "/settings/export",
    importPreview: "/settings/import/preview",
    importExecute: "/settings/import",
    resetPreview: "/settings/reset/preview",
    resetExecute: "/settings/reset",
    plugins: "/settings/plugins",
    pluginsInstallPreview: "/settings/plugins/install/preview",
    pluginsInstallExecute: "/settings/plugins/install",
    pluginsUninstallPreview: "/settings/plugins/uninstall/preview",
    pluginsUninstallExecute: "/settings/plugins/uninstall",
    pluginsRestoreDefaults: "/settings/plugins/restore-defaults",
    pluginsWallpaperMedia: "/settings/plugins/wallpaper-media",
  })
  assert.equal(pluginSandboxDocumentPath("wallpaper-engine"), "/settings/plugins/wallpaper-engine/sandbox-document")
  assert.equal(pluginAssetPath("my.plugin", "assets/bg image.png"), "/settings/plugins/my.plugin/assets/assets/bg%20image.png")
})
