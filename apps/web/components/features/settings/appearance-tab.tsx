"use client"

import {
  CheckIcon,
  ImageIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PanelTopIcon,
  RotateCcwIcon,
  SparklesIcon,
  SunIcon,
  UploadIcon,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

import { UnitNumberInput } from "@/components/features/settings/unit-number-input"
import { useSettings } from "@/components/settings/settings-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  restoreBrowserDefaultPlugins,
  uploadBrowserWallpaperMedia,
} from "@/lib/api/settings/settings-browser"
import {
  BODY_FONTS,
  CONTENT_WIDTHS,
  DENSITY_MODES,
  FONT_SCALES,
  LINE_HEIGHTS,
  MONO_FONTS,
  NAV_LAYOUTS,
  RADIUS_MODES,
  REDUCED_MOTION_MODES,
  THEME_MODES,
  THEME_PRESET_IDS,
} from "@/lib/settings/appearance-prefs"
import { validateWallpaperTuningDraft } from "@/lib/settings/settings-validation"
import {
  BUILTIN_WALLPAPER_MODES,
  type BuiltinWallpaperMode,
  DEFAULT_WALLPAPER_PLUGIN_ID,
} from "@/lib/settings/wallpaper-presets"
import type {
  PrimitiveConfigValue,
  SettingsContentWidth,
  SettingsDensity,
  SettingsFontFamily,
  SettingsFontScale,
  SettingsLineHeight,
  SettingsMonoFontFamily,
  SettingsNavigationLayout,
  SettingsRadius,
  SettingsReducedMotion,
  SettingsThemeMode,
  SettingsThemePreset,
} from "@/lib/settings/types"
import { cn } from "@/lib/utils"

function WallpaperTuningForm({
  wpConfig,
  activeMode,
  onSave,
}: {
  wpConfig: Record<string, PrimitiveConfigValue>
  activeMode: BuiltinWallpaperMode
  onSave: (tuning: {
    mediaUrl: string
    blurPx: number
    dimOpacity: number
    surfaceOpacity: number
    speed: number
    pauseWhenHidden: boolean
    nextMode: BuiltinWallpaperMode
  }) => void
}) {
  const t = useTranslations("settings.appearance")
  const tVal = useTranslations("settings.validation")
  const [mediaUrlDraft, setMediaUrlDraft] = useState(
    typeof wpConfig.mediaUrl === "string" ? wpConfig.mediaUrl : ""
  )
  const [blurDraft, setBlurDraft] = useState(String(wpConfig.blurPx ?? 8))
  const [dimDraft, setDimDraft] = useState(String(wpConfig.dimOpacity ?? 30))
  const [surfaceDraft, setSurfaceDraft] = useState(String(wpConfig.surfaceOpacity ?? 86))
  const [speedDraft, setSpeedDraft] = useState(String(wpConfig.speed ?? 100))
  const [pauseHiddenDraft, setPauseHiddenDraft] = useState(wpConfig.pauseWhenHidden !== false)

  const fieldErrors = validateWallpaperTuningDraft({
    mediaUrl: mediaUrlDraft,
    blurPx: blurDraft,
    dimOpacity: dimDraft,
    surfaceOpacity: surfaceDraft,
    speed: speedDraft,
  })
  const hasErrors = Object.keys(fieldErrors).length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (hasErrors) return

    const cleanUrl = mediaUrlDraft.trim()
    let nextMode: BuiltinWallpaperMode = activeMode
    if (cleanUrl && nextMode === "off") {
      const lowerUrl = cleanUrl.toLowerCase()
      nextMode =
        lowerUrl.endsWith(".mp4") || lowerUrl.endsWith(".webm") || lowerUrl.endsWith(".ogg")
          ? "video"
          : "image"
    }
    onSave({
      mediaUrl: cleanUrl,
      blurPx: Number(blurDraft.trim()),
      dimOpacity: Number(dimDraft.trim()),
      surfaceOpacity: Number(surfaceDraft.trim()),
      speed: Number(speedDraft.trim()),
      pauseWhenHidden: pauseHiddenDraft,
      nextMode,
    })
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-md border border-border bg-background p-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wp-media-url">{t("wallpaperMediaUrlLabel")}</Label>
        <Input
          id="wp-media-url"
          value={mediaUrlDraft}
          onChange={(e) => setMediaUrlDraft(e.target.value)}
          placeholder="https://example.com/wallpaper.mp4"
          aria-invalid={fieldErrors.mediaUrl ? true : undefined}
          className="font-mono"
        />
        {fieldErrors.mediaUrl && (
          <p role="alert" className="text-caption text-destructive">
            {tVal(fieldErrors.mediaUrl)}
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="wp-blur">{t("wallpaperBlurLabel")}</Label>
          <UnitNumberInput
            id="wp-blur"
            type="number"
            min={0}
            max={32}
            step={1}
            unit="px"
            hint="0–32 px"
            value={blurDraft}
            onChange={(e) => setBlurDraft(e.target.value)}
            error={fieldErrors.blurPx ? tVal(fieldErrors.blurPx) : null}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="wp-dim">{t("wallpaperDimLabel")}</Label>
          <UnitNumberInput
            id="wp-dim"
            type="number"
            min={0}
            max={85}
            step={1}
            unit="%"
            hint="0–85 %"
            value={dimDraft}
            onChange={(e) => setDimDraft(e.target.value)}
            error={fieldErrors.dimOpacity ? tVal(fieldErrors.dimOpacity) : null}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="wp-surface">{t("wallpaperSurfaceOpacityLabel")}</Label>
          <UnitNumberInput
            id="wp-surface"
            type="number"
            min={45}
            max={100}
            step={1}
            unit="%"
            hint="45–100 %"
            value={surfaceDraft}
            onChange={(e) => setSurfaceDraft(e.target.value)}
            error={fieldErrors.surfaceOpacity ? tVal(fieldErrors.surfaceOpacity) : null}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="wp-speed">{t("wallpaperSpeedLabel")}</Label>
          <UnitNumberInput
            id="wp-speed"
            type="number"
            min={25}
            max={250}
            step={1}
            unit="%"
            hint="25–250 %"
            value={speedDraft}
            onChange={(e) => setSpeedDraft(e.target.value)}
            error={fieldErrors.speed ? tVal(fieldErrors.speed) : null}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2.5 text-body-sm select-none">
          <Checkbox
            checked={pauseHiddenDraft}
            onCheckedChange={(val) => setPauseHiddenDraft(val === true)}
          />
          <span>{t("wallpaperPauseHiddenLabel")}</span>
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={hasErrors}>
          {t("wallpaperApplyTuningCta")}
        </Button>
      </div>
    </form>
  )
}

export function AppearanceTab() {
  const t = useTranslations("settings.appearance")
  const tPresets = useTranslations("theme.presets")
  const tTheme = useTranslations("theme")
  const { appearance, behavior, snapshot, updatePreferences, applySnapshot } = useSettings()
  const mediaInputRef = useRef<HTMLInputElement | null>(null)
  const [wallpaperBusy, setWallpaperBusy] = useState(false)

  const patchAppearance = (patch: Partial<typeof appearance>) => {
    void updatePreferences({ appearance: patch })
  }

  const wallpaperPlugin = snapshot?.plugins.discovered.find(
    (plugin) => plugin.id === DEFAULT_WALLPAPER_PLUGIN_ID
  )
  const externalWallpaper = snapshot?.plugins.discovered.find(
    (plugin) =>
      plugin.id !== DEFAULT_WALLPAPER_PLUGIN_ID &&
      plugin.enabled &&
      plugin.capabilities.includes("live-wallpaper")
  )
  const wpConfig: Record<string, PrimitiveConfigValue> = {
    ...(wallpaperPlugin?.config ?? {}),
    ...(snapshot?.document.plugins.entries[DEFAULT_WALLPAPER_PLUGIN_ID]?.config ?? {}),
  }
  const rawMode =
    typeof wpConfig.mode === "string" ? wpConfig.mode.trim().toLowerCase() : "off"
  const activeMode: BuiltinWallpaperMode = BUILTIN_WALLPAPER_MODES.includes(
    rawMode as BuiltinWallpaperMode
  )
    ? (rawMode as BuiltinWallpaperMode)
    : "off"

  const handleSelectWallpaperMode = (mode: string) => {
    void updatePreferences({
      plugins: {
        enabled: true,
        entries: {
          [DEFAULT_WALLPAPER_PLUGIN_ID]: {
            enabled: mode !== "off",
            source: "builtin",
            config: {
              ...wpConfig,
              mode,
            },
          },
        },
      },
    })
  }

  const handleUploadWallpaperMedia = async (file: File) => {
    setWallpaperBusy(true)
    try {
      const next = await uploadBrowserWallpaperMedia(file)
      applySnapshot(next)
      toast.success(t("wallpaperMediaUploaded"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("wallpaperMediaUploadFailed"))
    } finally {
      setWallpaperBusy(false)
    }
  }

  const handleRestoreWallpaperPlugin = async () => {
    setWallpaperBusy(true)
    try {
      const next = await restoreBrowserDefaultPlugins()
      applySnapshot(next)
      toast.success(t("wallpaperRestored"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("wallpaperRestoreFailed"))
    } finally {
      setWallpaperBusy(false)
    }
  }

  const handleSaveWallpaperTuning = (tuning: {
    mediaUrl: string
    blurPx: number
    dimOpacity: number
    surfaceOpacity: number
    speed: number
    pauseWhenHidden: boolean
    nextMode: BuiltinWallpaperMode
  }) => {
    void updatePreferences({
      plugins: {
        enabled: true,
        entries: {
          [DEFAULT_WALLPAPER_PLUGIN_ID]: {
            enabled: tuning.nextMode !== "off",
            source: "builtin",
            config: {
              ...wpConfig,
              mode: tuning.nextMode,
              mediaUrl: tuning.mediaUrl,
              blurPx: tuning.blurPx,
              dimOpacity: tuning.dimOpacity,
              surfaceOpacity: tuning.surfaceOpacity,
              speed: tuning.speed,
              pauseWhenHidden: tuning.pauseWhenHidden,
            },
          },
        },
      },
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Live preview card */}
      <Card>
        <CardHeader>
          <CardTitle>{t("previewTitle")}</CardTitle>
          <CardDescription>{t("previewDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-heading-md">{t("previewProjectTitle")}</h3>
                <code className="font-mono text-caption text-muted-foreground">
                  D:\Coding\PkgSteward\apps\web
                </code>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">{t("previewCleanBadge")}</Badge>
                <Badge variant="warning">{t("previewWarningBadge")}</Badge>
                <Button type="button" size="sm" variant="secondary">
                  {t("previewSecondaryCta")}
                </Button>
                <Button type="button" size="sm">
                  {t("previewPrimaryCta")}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Theme Mode & Color Presets */}
      <Card>
        <CardHeader>
          <CardTitle>{t("themeSectionTitle")}</CardTitle>
          <CardDescription>{t("themeSectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label>{tTheme("label")}</Label>
            <ToggleGroup
              type="single"
              value={appearance.themeMode}
              onValueChange={(value) => {
                if (value && THEME_MODES.includes(value as SettingsThemeMode)) {
                  patchAppearance({ themeMode: value as SettingsThemeMode })
                }
              }}
            >
              <ToggleGroupItem value="light">
                <SunIcon className="size-4" aria-hidden />
                {tTheme("light")}
              </ToggleGroupItem>
              <ToggleGroupItem value="dark">
                <MoonIcon className="size-4" aria-hidden />
                {tTheme("dark")}
              </ToggleGroupItem>
              <ToggleGroupItem value="system">
                <MonitorIcon className="size-4" aria-hidden />
                {tTheme("system")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-2.5">
            <Label>{t("presetLabel")}</Label>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {THEME_PRESET_IDS.map((preset) => {
                const selected = appearance.themePreset === preset
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => patchAppearance({ themePreset: preset as SettingsThemePreset })}
                    className={cn(
                      "flex flex-col gap-3 rounded-md border p-3 text-left transition-colors focus-ring",
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-background hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body-sm font-semibold text-foreground">
                        {tPresets(preset)}
                      </span>
                      {selected && <CheckIcon className="size-4 text-primary" aria-hidden />}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        data-theme={preset}
                        className="flex items-center justify-between rounded-sm border border-border bg-background px-2.5 py-2"
                      >
                        <span className="text-caption font-medium text-foreground">Aa</span>
                        <span className="flex items-center gap-1">
                          <span className="size-3.5 rounded-full bg-primary" />
                          <span className="size-3.5 rounded-full bg-card border border-border" />
                        </span>
                      </div>
                      <div
                        data-theme={preset}
                        className="dark flex items-center justify-between rounded-sm border border-border bg-background px-2.5 py-2"
                      >
                        <span className="text-caption font-medium text-foreground">Aa</span>
                        <span className="flex items-center gap-1">
                          <span className="size-3.5 rounded-full bg-primary" />
                          <span className="size-3.5 rounded-full bg-card border border-border" />
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live Wallpaper Studio (Pre-installed Removable Plugin) */}
      {snapshot && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-5 text-primary" aria-hidden />
                <CardTitle>{t("wallpaperTitle")}</CardTitle>
              </div>
              {wallpaperPlugin ? (
                <Badge variant={activeMode === "off" ? "secondary" : "success"}>
                  {activeMode === "off" ? t("wallpaperOffBadge") : t(`wallpaperModes.${activeMode}`)}
                </Badge>
              ) : (
                <Badge variant="outline">{t("wallpaperUninstalledBadge")}</Badge>
              )}
            </div>
            <CardDescription>{t("wallpaperDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {externalWallpaper && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-primary/5 p-3 text-body-sm text-foreground">
                <SparklesIcon className="size-4 shrink-0 text-primary" aria-hidden />
                <span>
                  {t("externalWallpaperActiveNotice", { name: externalWallpaper.name })}
                </span>
              </div>
            )}

            {!wallpaperPlugin ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-4">
                <p className="text-body-sm text-muted-foreground">
                  {t("wallpaperUninstalledHint")}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={wallpaperBusy}
                  onClick={() => void handleRestoreWallpaperPlugin()}
                >
                  <RotateCcwIcon className="size-4" aria-hidden />
                  {t("restoreWallpaperCta")}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label>{t("wallpaperPresetLabel")}</Label>
                  <ToggleGroup
                    type="single"
                    value={activeMode}
                    onValueChange={(val) => {
                      if (val) handleSelectWallpaperMode(val)
                    }}
                  >
                    {BUILTIN_WALLPAPER_MODES.filter((mode) => mode !== "image" && mode !== "video").map(
                      (mode) => (
                        <ToggleGroupItem key={mode} value={mode}>
                          {t(`wallpaperModes.${mode}`)}
                        </ToggleGroupItem>
                      )
                    )}
                    {(wpConfig.mediaAsset || wpConfig.mediaUrl) && (
                      <ToggleGroupItem value={activeMode === "video" ? "video" : "image"}>
                        <ImageIcon className="size-4" aria-hidden />
                        {t("wallpaperModes.customMedia")}
                      </ToggleGroupItem>
                    )}
                  </ToggleGroup>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={mediaInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
                    className="hidden"
                    onChange={(e) => {
                      const picked = e.target.files?.[0]
                      if (picked) {
                        void handleUploadWallpaperMedia(picked)
                      }
                      e.target.value = ""
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={wallpaperBusy}
                    onClick={() => mediaInputRef.current?.click()}
                  >
                    <UploadIcon className="size-4" aria-hidden />
                    {t("uploadWallpaperMediaCta")}
                  </Button>
                  {typeof wpConfig.mediaAsset === "string" && wpConfig.mediaAsset && (
                    <span className="font-mono text-caption text-muted-foreground">
                      {wpConfig.mediaAsset}
                    </span>
                  )}
                </div>

                {behavior.advancedMode && (
                  <WallpaperTuningForm
                    key={JSON.stringify(wpConfig)}
                    wpConfig={wpConfig}
                    activeMode={activeMode}
                    onSave={handleSaveWallpaperTuning}
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Typography */}
      <Card>
        <CardHeader>
          <CardTitle>{t("typographySectionTitle")}</CardTitle>
          <CardDescription>{t("typographySectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>{t("fontFamilyLabel")}</Label>
            <ToggleGroup
              type="single"
              value={appearance.fontFamily}
              onValueChange={(val) => {
                if (val && BODY_FONTS.includes(val as SettingsFontFamily)) {
                  patchAppearance({ fontFamily: val as SettingsFontFamily })
                }
              }}
            >
              {BODY_FONTS.map((font) => (
                <ToggleGroupItem key={font} value={font}>
                  {t(`fonts.${font}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {behavior.advancedMode && (
            <div className="flex flex-col gap-2">
              <Label>{t("monoFontLabel")}</Label>
              <ToggleGroup
                type="single"
                value={appearance.monoFontFamily}
                onValueChange={(val) => {
                  if (val && MONO_FONTS.includes(val as SettingsMonoFontFamily)) {
                    patchAppearance({ monoFontFamily: val as SettingsMonoFontFamily })
                  }
                }}
              >
                {MONO_FONTS.map((mono) => (
                  <ToggleGroupItem key={mono} value={mono} className="font-mono">
                    {t(`monoFonts.${mono}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>{t("fontScaleLabel")}</Label>
            <ToggleGroup
              type="single"
              value={String(appearance.fontScale)}
              onValueChange={(val) => {
                const parsed = Number(val)
                if (val && FONT_SCALES.includes(parsed as SettingsFontScale)) {
                  patchAppearance({ fontScale: parsed as SettingsFontScale })
                }
              }}
            >
              {FONT_SCALES.map((scale) => (
                <ToggleGroupItem key={scale} value={String(scale)}>
                  {scale}%
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {behavior.advancedMode && (
            <div className="flex flex-col gap-2">
              <Label>{t("lineHeightLabel")}</Label>
              <ToggleGroup
                type="single"
                value={appearance.lineHeight}
                onValueChange={(val) => {
                  if (val && LINE_HEIGHTS.includes(val as SettingsLineHeight)) {
                    patchAppearance({ lineHeight: val as SettingsLineHeight })
                  }
                }}
              >
                {LINE_HEIGHTS.map((lh) => (
                  <ToggleGroupItem key={lh} value={lh}>
                    {t(`lineHeights.${lh}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shape, Density, Content Width & Shell Layout */}
      <Card>
        <CardHeader>
          <CardTitle>{t("layoutSectionTitle")}</CardTitle>
          <CardDescription>{t("layoutSectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>{t("navigationLayoutLabel")}</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {NAV_LAYOUTS.map((layout) => {
                const selected = appearance.navigationLayout === layout
                const Icon = layout === "topbar" ? PanelTopIcon : PanelLeftIcon
                return (
                  <button
                    key={layout}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      patchAppearance({
                        navigationLayout: layout as SettingsNavigationLayout,
                      })
                    }
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-md border p-3.5 text-left transition-colors focus-ring",
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-background hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="size-5 shrink-0 text-primary" aria-hidden />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-body-sm font-semibold text-foreground">
                          {t(`navLayouts.${layout}`)}
                        </span>
                        <span className="text-caption text-muted-foreground">
                          {t(`navLayouts.${layout}Desc`)}
                        </span>
                      </div>
                    </div>
                    {selected && <CheckIcon className="size-4 text-primary" aria-hidden />}
                  </button>
                )
              })}
            </div>
          </div>

          {behavior.advancedMode && appearance.navigationLayout === "sidebar" && (
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
              <Checkbox
                checked={appearance.sidebarCollapsed}
                onCheckedChange={(val) => patchAppearance({ sidebarCollapsed: val === true })}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-body-sm font-medium text-foreground">
                  {t("sidebarCollapsedLabel")}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("sidebarCollapsedDesc")}
                </span>
              </div>
            </label>
          )}

          {behavior.advancedMode && (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t("radiusLabel")}</Label>
                <ToggleGroup
                  type="single"
                  value={appearance.radius}
                  onValueChange={(val) => {
                    if (val && RADIUS_MODES.includes(val as SettingsRadius)) {
                      patchAppearance({ radius: val as SettingsRadius })
                    }
                  }}
                >
                  {RADIUS_MODES.map((rad) => (
                    <ToggleGroupItem key={rad} value={rad}>
                      {t(`radii.${rad}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className="flex flex-col gap-2">
                <Label>{t("densityLabel")}</Label>
                <ToggleGroup
                  type="single"
                  value={appearance.density}
                  onValueChange={(val) => {
                    if (val && DENSITY_MODES.includes(val as SettingsDensity)) {
                      patchAppearance({ density: val as SettingsDensity })
                    }
                  }}
                >
                  {DENSITY_MODES.map((den) => (
                    <ToggleGroupItem key={den} value={den}>
                      {t(`densities.${den}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className="flex flex-col gap-2">
                <Label>{t("contentWidthLabel")}</Label>
                <ToggleGroup
                  type="single"
                  value={appearance.contentWidth}
                  onValueChange={(val) => {
                    if (val && CONTENT_WIDTHS.includes(val as SettingsContentWidth)) {
                      patchAppearance({ contentWidth: val as SettingsContentWidth })
                    }
                  }}
                >
                  {CONTENT_WIDTHS.map((width) => (
                    <ToggleGroupItem key={width} value={width}>
                      {t(`widths.${width}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Accessibility (Advanced) */}
      {behavior.advancedMode && (
        <Card>
          <CardHeader>
            <CardTitle>{t("accessibilityTitle")}</CardTitle>
            <CardDescription>{t("accessibilityDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>{t("reducedMotionLabel")}</Label>
              <ToggleGroup
                type="single"
                value={appearance.reducedMotion}
                onValueChange={(val) => {
                  if (val && REDUCED_MOTION_MODES.includes(val as SettingsReducedMotion)) {
                    patchAppearance({ reducedMotion: val as SettingsReducedMotion })
                  }
                }}
              >
                {REDUCED_MOTION_MODES.map((motion) => (
                  <ToggleGroupItem key={motion} value={motion}>
                    {t(`motions.${motion}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
              <Checkbox
                checked={appearance.highContrastBorders}
                onCheckedChange={(val) => patchAppearance({ highContrastBorders: val === true })}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-body-sm font-medium text-foreground">
                  {t("highContrastBordersLabel")}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("highContrastBordersDesc")}
                </span>
              </div>
            </label>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
