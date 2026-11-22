import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildBrowserPluginAssetUrl,
  executeBrowserPluginInstall,
  executeBrowserPluginUninstall,
  executeBrowserSettingsImport,
  executeBrowserSettingsReset,
  executeBrowserSettingsUpdate,
  exportBrowserSettings,
  getBrowserPluginsCatalog,
  getBrowserPluginSandboxDocument,
  getBrowserSettings,
  previewBrowserPluginInstallUrl,
  previewBrowserPluginUninstall,
  previewBrowserSettingsImport,
  previewBrowserSettingsReset,
  previewBrowserSettingsUpdate,
  restoreBrowserDefaultPlugins,
  updateBrowserPreferences,
} from "./settings-browser.ts"

const id = "00000000-0000-4000-8000-000000000001"
const confirmBody = { previewId: id, confirm: true, acknowledgedRisks: ["BROAD_SCAN_ROOTS"] }
const prefBody = { appearance: { themePreset: "ocean" } }
const previewBody = { runtime: { maxScanDepth: 3 } }
const docBody = { schemaVersion: 1 }

const cases = [
  [(s) => getBrowserSettings(s), "/api/settings", "GET"],
  [(s) => updateBrowserPreferences(prefBody, s), "/api/settings/preferences", "PATCH", prefBody],
  [(s) => previewBrowserSettingsUpdate(previewBody, s), "/api/settings/preview", "POST", previewBody],
  [(s) => executeBrowserSettingsUpdate(confirmBody, s), "/api/settings", "PATCH", confirmBody],
  [(s) => exportBrowserSettings(s), "/api/settings/export", "GET"],
  [(s) => previewBrowserSettingsImport(docBody, s), "/api/settings/import/preview", "POST", { document: docBody }],
  [(s) => executeBrowserSettingsImport(confirmBody, s), "/api/settings/import", "POST", confirmBody],
  [(s) => previewBrowserSettingsReset("appearance", s), "/api/settings/reset/preview", "POST", { scope: "appearance" }],
  [(s) => executeBrowserSettingsReset(confirmBody, s), "/api/settings/reset", "POST", confirmBody],
  [(s) => getBrowserPluginsCatalog(s), "/api/settings/plugins", "GET"],
  [(s) => previewBrowserPluginInstallUrl("https://github.com/a/b", s), "/api/settings/plugins/install/preview", "POST", { url: "https://github.com/a/b" }],
  [(s) => executeBrowserPluginInstall(confirmBody, s), "/api/settings/plugins/install", "POST", confirmBody],
  [(s) => previewBrowserPluginUninstall("wallpaper-engine", s), "/api/settings/plugins/uninstall/preview", "POST", { pluginId: "wallpaper-engine" }],
  [(s) => executeBrowserPluginUninstall({ previewId: id, confirm: true }, s), "/api/settings/plugins/uninstall", "POST", { previewId: id, confirm: true }],
  [(s) => restoreBrowserDefaultPlugins(s), "/api/settings/plugins/restore-defaults", "POST", {}],
  [(s) => getBrowserPluginSandboxDocument("wallpaper-engine", s), "/api/settings/plugins/wallpaper-engine/sandbox-document", "GET"],
]

test("buildBrowserPluginAssetUrl encodes plugin and nested asset segments safely", () => {
  assert.equal(
    buildBrowserPluginAssetUrl("wallpaper-engine", "assets/my bg.png"),
    "/api/settings/plugins/wallpaper-engine/assets/assets/my%20bg.png"
  )
})

test("all 10 settings browser functions target same-origin /api/settings/* with no-store", async (t) => {
  for (const [call, url, method, body] of cases) {
    let captured
    const data = { ok: true }
    t.mock.method(globalThis, "fetch", async (reqUrl, init) => {
      captured = { url: reqUrl, init }
      return Response.json({ statusCode: 200, message: "TEST", data })
    })
    const controller = new AbortController()
    assert.deepEqual(await call(controller.signal), data)
    assert.equal(captured.url, url)
    assert.equal(captured.init.method, method)
    assert.equal(captured.init.cache, "no-store")
    assert.equal(captured.init.body, body ? JSON.stringify(body) : undefined)
    controller.abort()
    assert.equal(captured.init.signal.aborted, true)
  }
})
