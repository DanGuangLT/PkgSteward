import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveActiveWallpaper } from "./wallpaper-presets.ts"

function makeSnapshot(overrides = {}) {
  return {
    document: {
      schemaVersion: 1,
      runtime: { scanRootPaths: "*", maxScanDepth: 0, scanTimeoutMs: null, npmCommandTimeoutMs: null },
      server: {
        mode: "development",
        host: "127.0.0.1",
        port: 24681,
        globalPrefix: "api",
        version: "1",
        listOriginCors: "http://localhost:24680",
        exportSwaggerApiJson: true,
      },
      appearance: {
        themeMode: "system",
        themePreset: "default",
        fontFamily: "inter",
        monoFontFamily: "geist-mono",
        fontScale: 100,
        lineHeight: "normal",
        radius: "default",
        density: "comfortable",
        contentWidth: "standard",
        navigationLayout: "topbar",
        sidebarCollapsed: false,
        reducedMotion: "system",
        highContrastBorders: false,
        showBreadcrumbs: true,
      },
      behavior: {
        locale: "vi",
        defaultConsoleShell: "powershell",
        defaultPageSize: 25,
        autoRefreshOnFocus: true,
        confirmBeforeNavigation: true,
        dateFormat: "relative",
        showDesignSystemInNav: false,
        advancedMode: false,
      },
      plugins: {
        enabled: true,
        directory: null,
        allowLocalPlugins: true,
        trustedRegistries: [],
        removedPreinstalled: [],
        entries: {
          "wallpaper-engine": {
            enabled: true,
            source: "builtin",
            config: { mode: "aurora", blurPx: 120, dimOpacity: -5, surfaceOpacity: 10, speed: 999 },
          },
        },
        ...(overrides.plugins ?? {}),
      },
      desktop: {},
    },
    plugins: {
      apiVersion: 1,
      runtimeMode: "sandboxed-web",
      pluginsEnabled: true,
      allowLocalPlugins: true,
      preinstalledAvailable: false,
      pluginsDir: "plugins",
      extensionPoints: [],
      discovered: overrides.discovered ?? [
        {
          id: "wallpaper-engine",
          name: "Live Wallpaper Engine",
          version: "1.0.0",
          apiVersion: 1,
          format: "manifest.json",
          entry: { kind: "builtin-wallpaper", file: null },
          description: null,
          author: "PkgSteward",
          homepage: null,
          capabilities: ["live-wallpaper"],
          minAppVersion: null,
          manifestPath: "manifest.json",
          source: "local",
          preinstalled: true,
          removable: true,
          origin: { kind: "preinstalled", sourceUrl: null, installedAt: null },
          enabled: true,
          config: { mode: "off" },
          settingsSchema: [],
        },
      ],
      invalid: [],
    },
  }
}

test("resolveActiveWallpaper clamps visual bounds for active built-in preset", () => {
  const res = resolveActiveWallpaper(makeSnapshot())
  assert.equal(res.active, true)
  if (res.active) {
    assert.equal(res.kind, "builtin-canvas")
    assert.equal(res.builtinPreset, "aurora")
    assert.equal(res.blurPx, 32)
    assert.equal(res.dimOpacity, 0)
    assert.equal(res.surfaceOpacity, 45)
    assert.equal(res.speed, 250)
  }
})

test("resolveActiveWallpaper returns inactive when wallpaper-engine is uninstalled or plugins disabled", () => {
  assert.deepEqual(resolveActiveWallpaper(makeSnapshot({ discovered: [] })), { active: false })
  assert.deepEqual(resolveActiveWallpaper(makeSnapshot({ plugins: { enabled: false } })), { active: false })
})

test("resolveActiveWallpaper prioritizes enabled external web-sandbox wallpaper plugin", () => {
  const base = makeSnapshot()
  base.plugins.discovered.push({
    id: "cyber-rain",
    name: "Cyber Rain",
    version: "1.0.0",
    apiVersion: 1,
    format: "project.json",
    entry: { kind: "web-sandbox", file: "index.html" },
    description: null,
    author: null,
    homepage: null,
    capabilities: ["live-wallpaper"],
    minAppVersion: null,
    manifestPath: "project.json",
    source: "local",
    preinstalled: false,
    removable: true,
    origin: { kind: "file", sourceUrl: null, installedAt: null },
    enabled: true,
    config: {},
    settingsSchema: [],
  })
  base.document.plugins.entries["cyber-rain"] = { enabled: true, source: "local", config: { rain: 2 } }
  const res = resolveActiveWallpaper(base)
  assert.equal(res.active, true)
  if (res.active) {
    assert.equal(res.kind, "sandbox-html")
    assert.equal(res.sourcePluginId, "cyber-rain")
  }
})
