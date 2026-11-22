import { test } from "node:test"
import assert from "node:assert/strict"
import {
  formatDurationHintMs,
  inferScanRootMode,
  MAX_TIMEOUT_MS,
  normalizeDrivePath,
  parseImportSettingsJson,
  resolvePluginFieldUnit,
  validateBackupImportText,
  validateMaxDepthInput,
  validatePluginConfigDraft,
  validatePluginDirectoryInput,
  validatePluginInstallUrlInput,
  validateScanRootInput,
  validateServerDraft,
  validateServerDraftFields,
  validateTimeoutInput,
  validateTrustedRegistriesInput,
  validateSurfaceGlassDraft,
  validateTextReadabilityDraft,
  validateWallpaperMediaUrl,
  validateWallpaperTuningDraft,
} from "./settings-validation.ts"

test("validateScanRootInput accepts absolute paths and rejects relative, traversal, and mixed wildcards", () => {
  assert.equal(validateScanRootInput("D:\\Projects"), null)
  assert.equal(validateScanRootInput("D:\\Projects, E:\\Work"), null)
  assert.equal(validateScanRootInput("/home/user/projects"), null)
  assert.equal(validateScanRootInput("relative/dir"), "SCAN_ROOTS_ABSOLUTE")
  assert.equal(validateScanRootInput("D:\\Projects, relative"), "SCAN_ROOTS_ABSOLUTE")
  assert.equal(validateScanRootInput("D:\\Projects\\..\\Secret"), "SCAN_ROOTS_TRAVERSAL")
  assert.equal(validateScanRootInput("D:\\Projects\\*"), "SCAN_ROOTS_WILDCARD")
  assert.equal(validateScanRootInput("D:\\Projects, *"), "SCAN_ROOTS_WILDCARD")
})

test("validateTimeoutInput and validateMaxDepthInput enforce integer and upper bounds", () => {
  assert.equal(validateTimeoutInput(false, "10"), null)
  assert.equal(validateTimeoutInput(true, "1000"), null)
  assert.equal(validateTimeoutInput(true, String(MAX_TIMEOUT_MS)), null)
  assert.equal(validateTimeoutInput(true, ""), "TIMEOUT_MIN_1000")
  assert.equal(validateTimeoutInput(true, "999"), "TIMEOUT_MIN_1000")
  assert.equal(validateTimeoutInput(true, String(MAX_TIMEOUT_MS + 1)), "TIMEOUT_MAX_24H")
  assert.equal(validateMaxDepthInput("0"), null)
  assert.equal(validateMaxDepthInput(""), "DEPTH_RANGE")
  assert.equal(validateMaxDepthInput("21"), "DEPTH_RANGE")
})

test("validateServerDraft and validateServerDraftFields enforce loopback host, port range, and safe CORS origins", () => {
  const okInput = {
    host: "127.0.0.1",
    port: "24681",
    globalPrefix: "api",
    version: "1",
    listOriginCors: "http://localhost:24680, http://127.0.0.1:24680",
  }
  assert.equal(validateServerDraft(okInput), null)
  assert.deepEqual(validateServerDraftFields(okInput), {})

  assert.deepEqual(
    validateServerDraftFields({
      host: "0.0.0.0",
      port: "70000",
      globalPrefix: "bad/prefix",
      version: "",
      listOriginCors: "*",
    }),
    {
      host: "SERVER_HOST",
      port: "SERVER_PORT",
      globalPrefix: "SERVER_PREFIX",
      version: "SERVER_VERSION",
      listOriginCors: "SERVER_CORS",
    }
  )
})

test("validateWallpaperTuningDraft checks HTTPS mediaUrl and all 4 numeric bounds", () => {
  assert.deepEqual(
    validateWallpaperTuningDraft({
      blurPx: "8",
      dimOpacity: "30",
      surfaceOpacity: "86",
      speed: "100",
    }),
    {}
  )

  assert.deepEqual(
    validateWallpaperTuningDraft({
      mediaUrl: "javascript:alert(1)",
      blurPx: "33",
      dimOpacity: "-1",
      surfaceOpacity: "20",
      speed: "300",
    }),
    {
      mediaUrl: "WALLPAPER_URL_HTTPS",
      blurPx: "WALLPAPER_BLUR_RANGE",
      dimOpacity: "WALLPAPER_DIM_RANGE",
      surfaceOpacity: "WALLPAPER_SURFACE_RANGE",
      speed: "WALLPAPER_SPEED_RANGE",
    }
  )

  assert.equal(validateWallpaperMediaUrl("", { required: true }), "WALLPAPER_URL_REQUIRED")
  assert.equal(validateWallpaperMediaUrl("https://www.google.com/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fa.jpg"), null)
  assert.equal(validateWallpaperMediaUrl(`https://cdn.example.com/${"a".repeat(2040)}.jpg`), "WALLPAPER_URL_TOO_LONG")
})

test("plugin validators validate install URLs, directories, registries, and schema configs", () => {
  assert.equal(validatePluginInstallUrlInput("https://github.com/user/wall"), null)
  assert.equal(validatePluginInstallUrlInput("http://127.0.0.1:8080/plugin.zip"), null)
  assert.equal(validatePluginInstallUrlInput("npm:@scope/pkg-wall@1.0.0"), null)
  assert.equal(validatePluginInstallUrlInput(""), "PLUGIN_URL_REQUIRED")
  assert.equal(validatePluginInstallUrlInput("npm:--flag"), "PLUGIN_NPM_SPEC")
  assert.equal(validatePluginInstallUrlInput("http://evil.example.com/a.zip"), "PLUGIN_URL_INVALID")

  assert.equal(validatePluginDirectoryInput(""), null)
  assert.equal(validatePluginDirectoryInput("D:\\PkgSteward\\plugins"), null)
  assert.equal(validatePluginDirectoryInput("D:\\PkgSteward\\..\\plugins"), "PLUGIN_DIR_TRAVERSAL")
  assert.equal(validatePluginDirectoryInput("relative/plugins"), "PLUGIN_DIR_ABSOLUTE")

  assert.equal(validateTrustedRegistriesInput("https://registry.npmjs.org, http://localhost:4873"), null)
  assert.equal(validateTrustedRegistriesInput("http://evil.example.com"), "PLUGIN_REGISTRIES_ORIGIN")

  const configErrors = validatePluginConfigDraft(
    [
      { key: "blurPx", label: "Blur", type: "number", defaultValue: 8, unit: "px" },
      { key: "mediaUrl", label: "URL", type: "string", defaultValue: "" },
    ],
    { blurPx: "99", mediaUrl: "http://insecure.example.com/bg.mp4" },
    "wallpaper-engine"
  )
  assert.deepEqual(configErrors, {
    blurPx: "WALLPAPER_BLUR_RANGE",
    mediaUrl: "WALLPAPER_URL_HTTPS",
  })
})

test("validateBackupImportText and parseImportSettingsJson reject unsafe, oversized, or malformed JSON", () => {
  assert.equal(parseImportSettingsJson("[1,2,3]").ok, false)
  assert.equal(parseImportSettingsJson("{oops").ok, false)
  assert.equal(validateBackupImportText("   ").code, "BACKUP_EMPTY")
  assert.equal(validateBackupImportText('{"PKGSTEWARD_DATA_DIR":"C:\\\\x"}').code, "BACKUP_DATA_DIR_FORBIDDEN")
  assert.equal(
    validateBackupImportText('{"appearance":{"__proto__":{"x":1}}}').code,
    "BACKUP_FORBIDDEN_KEY"
  )
  assert.equal(validateBackupImportText('{"schemaVersion":99}').code, "BACKUP_SCHEMA_UNSUPPORTED")
  assert.equal(validateBackupImportText("a".repeat(260 * 1024)).code, "BACKUP_TOO_LARGE")

  const parsed = parseImportSettingsJson('\uFEFF{"schemaVersion":1}')
  assert.equal(parsed.ok, true)
})

test("formatDurationHintMs and resolvePluginFieldUnit format readable units", () => {
  assert.equal(formatDurationHintMs("15000", "en"), "≈ 15 s")
  assert.equal(formatDurationHintMs("900000", "vi"), "≈ 15 phút")
  assert.equal(formatDurationHintMs("5400000", "en"), "≈ 1h 30m")
  assert.equal(formatDurationHintMs("500", "en"), null)

  assert.equal(
    resolvePluginFieldUnit({ key: "blurPx", label: "Blur", type: "number", defaultValue: 8, unit: "px" }),
    "px"
  )
  assert.equal(
    resolvePluginFieldUnit({ key: "intervalSeconds", label: "Interval", type: "number", defaultValue: 30 }),
    "s"
  )
})

test("normalizeDrivePath and inferScanRootMode classify '*', drive selections, and custom paths", () => {
  assert.equal(normalizeDrivePath("d:"), "D:\\")
  assert.equal(normalizeDrivePath("E:/"), "E:\\")
  assert.deepEqual(inferScanRootMode("*", ["C:\\", "D:\\"]), {
    mode: "all",
    selectedDrives: [],
    customPaths: [],
  })
  assert.deepEqual(inferScanRootMode("d:\\, E:\\", ["C:\\", "D:\\", "E:\\"]), {
    mode: "drives",
    selectedDrives: ["D:\\", "E:\\"],
    customPaths: [],
  })
  assert.deepEqual(inferScanRootMode("D:\\Coding\\Work", ["C:\\", "D:\\"]), {
    mode: "custom",
    selectedDrives: [],
    customPaths: ["D:\\Coding\\Work"],
  })
})

test("validateSurfaceGlassDraft validates opacity, blur, and saturation integer ranges", () => {
  assert.deepEqual(
    validateSurfaceGlassDraft({
      surfaceOpacity: "68",
      surfaceBlurPx: "24",
      surfaceSaturation: "185",
    }),
    {}
  )

  assert.deepEqual(
    validateSurfaceGlassDraft({
      surfaceOpacity: "35",
      surfaceBlurPx: "0",
      surfaceSaturation: "100",
    }),
    {}
  )

  assert.deepEqual(
    validateSurfaceGlassDraft({
      surfaceOpacity: "34",
      surfaceBlurPx: "41",
      surfaceSaturation: "221",
    }),
    {
      surfaceOpacity: "SURFACE_OPACITY_RANGE",
      surfaceBlurPx: "SURFACE_BLUR_RANGE",
      surfaceSaturation: "SURFACE_SATURATION_RANGE",
    }
  )

  assert.deepEqual(
    validateSurfaceGlassDraft({
      surfaceOpacity: "",
      surfaceBlurPx: "12.5",
      surfaceSaturation: "99",
    }),
    {
      surfaceOpacity: "SURFACE_OPACITY_RANGE",
      surfaceBlurPx: "SURFACE_BLUR_RANGE",
      surfaceSaturation: "SURFACE_SATURATION_RANGE",
    }
  )
})

test("validateTextReadabilityDraft checks custom HEX color and integer ranges", () => {
  assert.deepEqual(
    validateTextReadabilityDraft({
      textColorMode: "theme",
      textCustomColor: "",
      textShadowBlurPx: "8",
      textShadowOpacity: "78",
      textOutlineWidthPx: "0",
    }),
    {}
  )

  assert.deepEqual(
    validateTextReadabilityDraft({
      textColorMode: "custom",
      textCustomColor: "#fde68a",
      textShadowBlurPx: "24",
      textShadowOpacity: "100",
      textOutlineWidthPx: "3",
    }),
    {}
  )

  assert.deepEqual(
    validateTextReadabilityDraft({
      textColorMode: "custom",
      textCustomColor: "yellow",
      textShadowBlurPx: "25",
      textShadowOpacity: "-1",
      textOutlineWidthPx: "4",
    }),
    {
      textCustomColor: "TEXT_CUSTOM_COLOR_HEX",
      textShadowBlurPx: "TEXT_SHADOW_BLUR_RANGE",
      textShadowOpacity: "TEXT_SHADOW_OPACITY_RANGE",
      textOutlineWidthPx: "TEXT_OUTLINE_RANGE",
    }
  )

  assert.deepEqual(
    validateTextReadabilityDraft({
      textColorMode: "custom",
      textCustomColor: "#fff",
      textShadowBlurPx: "",
      textShadowOpacity: "50",
      textOutlineWidthPx: "1.5",
    }),
    {
      textCustomColor: "TEXT_CUSTOM_COLOR_HEX",
      textShadowBlurPx: "TEXT_SHADOW_BLUR_RANGE",
      textOutlineWidthPx: "TEXT_OUTLINE_RANGE",
    }
  )
})
