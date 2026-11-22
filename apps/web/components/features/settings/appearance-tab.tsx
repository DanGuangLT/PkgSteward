"use client"

import {
  CheckIcon,
  DropletsIcon,
  GlobeIcon,
  HardDriveIcon,
  ImageIcon,
  LayersIcon,
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
import type { CSSProperties } from "react"
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
  applyAppearanceToDocument,
  BODY_FONTS,
  CONTENT_WIDTHS,
  DENSITY_MODES,
  FONT_SCALES,
  LINE_HEIGHTS,
  MONO_FONTS,
  NAV_LAYOUTS,
  RADIUS_MODES,
  REDUCED_MOTION_MODES,
  SURFACE_BLUR_BOUNDS,
  SURFACE_OPACITY_BOUNDS,
  SURFACE_SATURATION_BOUNDS,
  SURFACE_STYLE_PRESETS,
  SURFACE_STYLES,
  THEME_MODES,
  THEME_PRESET_IDS,
} from "@/lib/settings/appearance-prefs"
import {
  validateSurfaceGlassDraft,
  validateWallpaperMediaUrl,
  validateWallpaperTuningDraft,
} from "@/lib/settings/settings-validation"
import {
  buildPluginAssetUrl,
  BUILTIN_WALLPAPER_ANIMATION_MODES,
  BUILTIN_WALLPAPER_MODES,
  type BuiltinWallpaperMode,
  DEFAULT_WALLPAPER_PLUGIN_ID,
  inferMediaKindFromAsset,
  inferMediaKindFromUrl,
  normalizeWallpaperMediaUrl,
  resolveWallpaperMediaSource,
  type WallpaperMediaSource,
} from "@/lib/settings/wallpaper-presets"
import type {
  AppearanceSettings,
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
  SettingsSurfaceStyle,
  SettingsThemeMode,
  SettingsThemePreset,
} from "@/lib/settings/types"
import { cn } from "@/lib/utils"

function CustomWallpaperMediaPanel({
  wpConfig,
  activeMode,
  busy,
  onUploadLocalFile,
  onUseLocalMedia,
  onApplyMediaUrl,
}: {
  wpConfig: Record<string, PrimitiveConfigValue>
  activeMode: BuiltinWallpaperMode
  busy: boolean
  onUploadLocalFile: (file: File) => Promise<void>
  onUseLocalMedia: (assetPath: string) => void
  onApplyMediaUrl: (url: string) => void
}) {
  const t = useTranslations("settings.appearance")
  const tVal = useTranslations("settings.validation")
  const mediaInputRef = useRef<HTMLInputElement | null>(null)

  const activeSource = resolveWallpaperMediaSource(wpConfig)
  const savedUrl = typeof wpConfig.mediaUrl === "string" ? wpConfig.mediaUrl : ""
  const savedAsset = typeof wpConfig.mediaAsset === "string" ? wpConfig.mediaAsset : ""

  const [sourceTab, setSourceTab] = useState<WallpaperMediaSource>(activeSource)
  const [urlDraft, setUrlDraft] = useState(savedUrl)
  const [urlSubmitted, setUrlSubmitted] = useState(false)
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null)

  const normalizedUrl = normalizeWallpaperMediaUrl(urlDraft)
  const rawUrlError =
    urlDraft.trim() !== "" || urlSubmitted
      ? validateWallpaperMediaUrl(urlDraft, { required: true })
      : null
  const canPreviewImage =
    normalizedUrl !== "" &&
    !validateWallpaperMediaUrl(urlDraft, { required: true }) &&
    inferMediaKindFromUrl(normalizedUrl) === "image"
  const urlLoadFailed = canPreviewImage && failedPreviewUrl === normalizedUrl

  const isCustomMediaActive = activeMode === "image" || activeMode === "video"
  const isLocalActive = isCustomMediaActive && activeSource === "local" && savedAsset !== ""
  const isUrlActive = isCustomMediaActive && activeSource === "url" && savedUrl !== ""
  const localAssetUrl = savedAsset ? buildPluginAssetUrl(DEFAULT_WALLPAPER_PLUGIN_ID, savedAsset) : null
  const isLocalVideo = savedAsset ? inferMediaKindFromAsset(savedAsset) === "video" : false

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-body-sm font-semibold text-foreground">
            {t("wallpaperCustomSectionTitle")}
          </span>
          <span className="text-caption text-muted-foreground">
            {t("wallpaperCustomSectionDesc")}
          </span>
        </div>
        {isLocalActive && <Badge variant="success">{t("wallpaperLocalActiveBadge")}</Badge>}
        {isUrlActive && <Badge variant="success">{t("wallpaperUrlActiveBadge")}</Badge>}
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("wallpaperSourceLabel")}</Label>
        <ToggleGroup
          type="single"
          value={sourceTab}
          onValueChange={(val) => {
            if (val === "local" || val === "url") setSourceTab(val)
          }}
          aria-label={t("wallpaperSourceLabel")}
        >
          <ToggleGroupItem value="local">
            <HardDriveIcon className="size-4" aria-hidden />
            {t("wallpaperSourceLocal")}
          </ToggleGroupItem>
          <ToggleGroupItem value="url">
            <GlobeIcon className="size-4" aria-hidden />
            {t("wallpaperSourceUrl")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {sourceTab === "local" ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-card/40 p-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              ref={mediaInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0]
                if (picked) {
                  void onUploadLocalFile(picked)
                }
                e.target.value = ""
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => mediaInputRef.current?.click()}
            >
              <UploadIcon className="size-4" aria-hidden />
              {t("uploadWallpaperMediaCta")}
            </Button>
            {savedAsset && (
              <Button
                type="button"
                size="sm"
                variant={isLocalActive ? "secondary" : "default"}
                disabled={busy || isLocalActive}
                onClick={() => onUseLocalMedia(savedAsset)}
              >
                <ImageIcon className="size-4" aria-hidden />
                {t("wallpaperUseLocalCta")}
              </Button>
            )}
          </div>

          {savedAsset && localAssetUrl ? (
            <div className="flex flex-wrap items-center gap-3">
              {!isLocalVideo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={localAssetUrl}
                  alt=""
                  className="h-16 w-28 rounded-sm border border-border object-cover"
                />
              )}
              <span className="truncate font-mono text-caption text-muted-foreground">
                {savedAsset}
              </span>
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">{t("wallpaperNoLocalUploaded")}</p>
          )}
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setUrlSubmitted(true)
            const err = validateWallpaperMediaUrl(urlDraft, { required: true })
            if (err) return
            onApplyMediaUrl(normalizedUrl)
          }}
          className="flex flex-col gap-3 rounded-md border border-border bg-card/40 p-3.5"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wp-media-url">{t("wallpaperMediaUrlLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="wp-media-url"
                value={urlDraft}
                onChange={(e) => {
                  setUrlDraft(e.target.value)
                  if (urlSubmitted) setUrlSubmitted(false)
                  setFailedPreviewUrl(null)
                }}
                placeholder={t("wallpaperMediaUrlPlaceholder")}
                aria-invalid={rawUrlError ? true : undefined}
                className="min-w-60 flex-1 font-mono"
              />
              <Button type="submit" disabled={busy || Boolean(rawUrlError)}>
                {t("wallpaperApplyUrlCta")}
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">{t("wallpaperMediaUrlHint")}</p>
            {rawUrlError && (
              <p role="alert" className="text-caption text-destructive">
                {tVal(rawUrlError)}
              </p>
            )}
          </div>

          {canPreviewImage && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-caption text-muted-foreground">
                  {t("wallpaperUrlPreviewLabel")}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={normalizedUrl}
                  src={normalizedUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onLoad={() => {
                    if (failedPreviewUrl) setFailedPreviewUrl(null)
                  }}
                  onError={() => setFailedPreviewUrl(normalizedUrl)}
                  className="h-20 w-36 rounded-sm border border-border bg-background object-cover"
                />
              </div>
              {urlLoadFailed && (
                <p
                  role="alert"
                  className="flex-1 rounded-md border border-warning/40 bg-warning-soft p-2.5 text-caption text-warning"
                >
                  {t("wallpaperUrlLoadError")}
                </p>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  )
}

function WallpaperTuningForm({
  wpConfig,
  onSave,
}: {
  wpConfig: Record<string, PrimitiveConfigValue>
  onSave: (tuning: {
    blurPx: number
    dimOpacity: number
    surfaceOpacity: number
    speed: number
    pauseWhenHidden: boolean
  }) => void
}) {
  const t = useTranslations("settings.appearance")
  const tVal = useTranslations("settings.validation")
  const [blurDraft, setBlurDraft] = useState(String(wpConfig.blurPx ?? 8))
  const [dimDraft, setDimDraft] = useState(String(wpConfig.dimOpacity ?? 30))
  const [surfaceDraft, setSurfaceDraft] = useState(String(wpConfig.surfaceOpacity ?? 86))
  const [speedDraft, setSpeedDraft] = useState(String(wpConfig.speed ?? 100))
  const [pauseHiddenDraft, setPauseHiddenDraft] = useState(wpConfig.pauseWhenHidden !== false)

  const fieldErrors = validateWallpaperTuningDraft({
    blurPx: blurDraft,
    dimOpacity: dimDraft,
    surfaceOpacity: surfaceDraft,
    speed: speedDraft,
  })
  const hasErrors = Object.keys(fieldErrors).length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (hasErrors) return

    onSave({
      blurPx: Number(blurDraft.trim()),
      dimOpacity: Number(dimDraft.trim()),
      surfaceOpacity: Number(surfaceDraft.trim()),
      speed: Number(speedDraft.trim()),
      pauseWhenHidden: pauseHiddenDraft,
    })
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-md border border-border bg-background p-4"
    >
      <span className="text-body-sm font-semibold text-foreground">{t("wallpaperTuningTitle")}</span>
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

function rangeProgressStyle(value: number, min: number, max: number): CSSProperties {
  const pct = max > min ? Math.round(((value - min) / (max - min)) * 100) : 0
  return { "--progress": `${Math.min(Math.max(pct, 0), 100)}%` } as CSSProperties
}

function parseIntInBounds(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number(raw.trim())
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

function SurfaceMaterialCard({
  appearance,
  advancedMode,
  onPatchAppearance,
}: {
  appearance: AppearanceSettings
  advancedMode: boolean
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
}) {
  const t = useTranslations("settings.appearance")
  const tVal = useTranslations("settings.validation")

  const isSolid = appearance.surfaceStyle === "solid"
  const [opacityDraft, setOpacityDraft] = useState(String(appearance.surfaceOpacity))
  const [blurDraft, setBlurDraft] = useState(String(appearance.surfaceBlurPx))
  const [saturationDraft, setSaturationDraft] = useState(String(appearance.surfaceSaturation))
  const [specularDraft, setSpecularDraft] = useState(appearance.surfaceSpecularBorder)

  const opacityNum = parseIntInBounds(
    opacityDraft,
    SURFACE_OPACITY_BOUNDS.min,
    SURFACE_OPACITY_BOUNDS.max,
    appearance.surfaceOpacity
  )
  const blurNum = parseIntInBounds(
    blurDraft,
    SURFACE_BLUR_BOUNDS.min,
    SURFACE_BLUR_BOUNDS.max,
    appearance.surfaceBlurPx
  )
  const saturationNum = parseIntInBounds(
    saturationDraft,
    SURFACE_SATURATION_BOUNDS.min,
    SURFACE_SATURATION_BOUNDS.max,
    appearance.surfaceSaturation
  )

  const glassErrors = validateSurfaceGlassDraft({
    surfaceOpacity: opacityDraft,
    surfaceBlurPx: blurDraft,
    surfaceSaturation: saturationDraft,
  })
  const hasErrors = Object.keys(glassErrors).length > 0

  const previewLiveGlass = (next: {
    surfaceOpacity?: number
    surfaceBlurPx?: number
    surfaceSaturation?: number
    surfaceSpecularBorder?: boolean
  }) => {
    if (typeof document === "undefined") return
    applyAppearanceToDocument(document, {
      ...appearance,
      surfaceOpacity: next.surfaceOpacity ?? opacityNum,
      surfaceBlurPx: next.surfaceBlurPx ?? blurNum,
      surfaceSaturation: next.surfaceSaturation ?? saturationNum,
      surfaceSpecularBorder: next.surfaceSpecularBorder ?? specularDraft,
    })
  }

  const commitOpacityRelease = (val: number) => {
    if (isSolid) return
    if (val !== appearance.surfaceOpacity) {
      onPatchAppearance({ surfaceOpacity: val })
    }
  }

  const renderPresetIcon = (style: SettingsSurfaceStyle) => {
    switch (style) {
      case "solid":
        return <LayersIcon className="size-4 shrink-0 text-primary" aria-hidden />
      case "frosted":
        return <SunIcon className="size-4 shrink-0 text-primary" aria-hidden />
      case "liquid-glass":
        return <DropletsIcon className="size-4 shrink-0 text-primary" aria-hidden />
      case "crystal":
        return <SparklesIcon className="size-4 shrink-0 text-primary" aria-hidden />
    }
  }

  const handleAdvancedSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isSolid || hasErrors) return
    onPatchAppearance({
      surfaceOpacity: Number(opacityDraft.trim()),
      surfaceBlurPx: Number(blurDraft.trim()),
      surfaceSaturation: Number(saturationDraft.trim()),
      surfaceSpecularBorder: specularDraft,
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DropletsIcon className="size-5 text-primary" aria-hidden />
            <CardTitle>{t("surfaceSectionTitle")}</CardTitle>
          </div>
          <Badge variant={isSolid ? "secondary" : "success"}>
            {t(`surfaceStyles.${appearance.surfaceStyle}`)} · {appearance.surfaceOpacity}%
          </Badge>
        </div>
        <CardDescription>{t("surfaceSectionDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SURFACE_STYLES.map((style) => {
            const preset = SURFACE_STYLE_PRESETS[style]
            const selected = appearance.surfaceStyle === style
            return (
              <button
                key={style}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onPatchAppearance({
                    surfaceStyle: style,
                    ...preset,
                  })
                }
                className={cn(
                  "flex flex-col justify-between gap-2 rounded-md border p-3.5 text-left transition-colors focus-ring",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-background hover:bg-muted/50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {renderPresetIcon(style)}
                    <span className="text-body-sm font-semibold text-foreground">
                      {t(`surfaceStyles.${style}`)}
                    </span>
                  </div>
                  {selected && <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden />}
                </div>
                <p className="text-caption text-muted-foreground">
                  {t(`surfaceStyleDescs.${style}`)}
                </p>
                <span className="font-mono text-caption text-muted-foreground">
                  {t("surfacePresetSummary", {
                    opacity: preset.surfaceOpacity,
                    blur: preset.surfaceBlurPx,
                  })}
                </span>
              </button>
            )
          })}
        </div>

        {isSolid ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-caption text-muted-foreground">
            {t("surfaceSolidHint")}
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="surface-opacity-slider">{t("surfaceOpacityLabel")}</Label>
              <Badge variant="outline" className="font-mono tabular-nums">
                {opacityNum} %
              </Badge>
            </div>
            <input
              id="surface-opacity-slider"
              type="range"
              className="app-range-slider h-2 w-full rounded-full"
              style={rangeProgressStyle(
                opacityNum,
                SURFACE_OPACITY_BOUNDS.min,
                SURFACE_OPACITY_BOUNDS.max
              )}
              min={SURFACE_OPACITY_BOUNDS.min}
              max={SURFACE_OPACITY_BOUNDS.max}
              step={1}
              value={opacityNum}
              onChange={(e) => {
                const next = Number(e.target.value)
                setOpacityDraft(String(next))
                previewLiveGlass({ surfaceOpacity: next })
              }}
              onPointerUp={(e) => commitOpacityRelease(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => commitOpacityRelease(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => {
                if (
                  e.key === "ArrowLeft" ||
                  e.key === "ArrowRight" ||
                  e.key === "ArrowUp" ||
                  e.key === "ArrowDown" ||
                  e.key === "Home" ||
                  e.key === "End" ||
                  e.key === "PageUp" ||
                  e.key === "PageDown"
                ) {
                  commitOpacityRelease(Number((e.target as HTMLInputElement).value))
                }
              }}
              onBlur={(e) => commitOpacityRelease(Number(e.target.value))}
            />
            <div className="flex items-center justify-between text-caption text-muted-foreground">
              <span>{t("surfaceOpacityMinLabel")}</span>
              <span>{t("surfaceOpacityMaxLabel")}</span>
            </div>
          </div>
        )}

        {advancedMode && (
          <form
            noValidate
            onSubmit={handleAdvancedSubmit}
            className={cn(
              "flex flex-col gap-4 rounded-md border border-border bg-background p-4",
              isSolid && "opacity-60"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body-sm font-semibold text-foreground">
                {t("surfaceTuningTitle")}
              </span>
              {isSolid && (
                <span className="text-caption text-muted-foreground">
                  {t("surfaceSolidDisabledHint")}
                </span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="surface-opacity-num">{t("surfaceOpacityLabel")}</Label>
                <UnitNumberInput
                  id="surface-opacity-num"
                  type="number"
                  min={SURFACE_OPACITY_BOUNDS.min}
                  max={SURFACE_OPACITY_BOUNDS.max}
                  step={1}
                  unit="%"
                  hint="35–100 %"
                  disabled={isSolid}
                  value={opacityDraft}
                  onChange={(e) => {
                    const raw = e.target.value
                    setOpacityDraft(raw)
                    const parsed = Number(raw.trim())
                    if (
                      Number.isSafeInteger(parsed) &&
                      parsed >= SURFACE_OPACITY_BOUNDS.min &&
                      parsed <= SURFACE_OPACITY_BOUNDS.max
                    ) {
                      previewLiveGlass({ surfaceOpacity: parsed })
                    }
                  }}
                  error={glassErrors.surfaceOpacity ? tVal(glassErrors.surfaceOpacity) : null}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="surface-blur-num">{t("surfaceBlurLabel")}</Label>
                <UnitNumberInput
                  id="surface-blur-num"
                  type="number"
                  min={SURFACE_BLUR_BOUNDS.min}
                  max={SURFACE_BLUR_BOUNDS.max}
                  step={1}
                  unit="px"
                  hint="0–40 px"
                  disabled={isSolid}
                  value={blurDraft}
                  onChange={(e) => {
                    const raw = e.target.value
                    setBlurDraft(raw)
                    const parsed = Number(raw.trim())
                    if (
                      Number.isSafeInteger(parsed) &&
                      parsed >= SURFACE_BLUR_BOUNDS.min &&
                      parsed <= SURFACE_BLUR_BOUNDS.max
                    ) {
                      previewLiveGlass({ surfaceBlurPx: parsed })
                    }
                  }}
                  error={glassErrors.surfaceBlurPx ? tVal(glassErrors.surfaceBlurPx) : null}
                />
                <input
                  type="range"
                  aria-label={t("surfaceBlurLabel")}
                  className="app-range-slider h-2 w-full rounded-full"
                  style={rangeProgressStyle(blurNum, SURFACE_BLUR_BOUNDS.min, SURFACE_BLUR_BOUNDS.max)}
                  min={SURFACE_BLUR_BOUNDS.min}
                  max={SURFACE_BLUR_BOUNDS.max}
                  step={1}
                  disabled={isSolid}
                  value={blurNum}
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    setBlurDraft(String(next))
                    previewLiveGlass({ surfaceBlurPx: next })
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="surface-saturation-num">{t("surfaceSaturationLabel")}</Label>
                <UnitNumberInput
                  id="surface-saturation-num"
                  type="number"
                  min={SURFACE_SATURATION_BOUNDS.min}
                  max={SURFACE_SATURATION_BOUNDS.max}
                  step={5}
                  unit="%"
                  hint="100–220 %"
                  disabled={isSolid}
                  value={saturationDraft}
                  onChange={(e) => {
                    const raw = e.target.value
                    setSaturationDraft(raw)
                    const parsed = Number(raw.trim())
                    if (
                      Number.isSafeInteger(parsed) &&
                      parsed >= SURFACE_SATURATION_BOUNDS.min &&
                      parsed <= SURFACE_SATURATION_BOUNDS.max
                    ) {
                      previewLiveGlass({ surfaceSaturation: parsed })
                    }
                  }}
                  error={glassErrors.surfaceSaturation ? tVal(glassErrors.surfaceSaturation) : null}
                />
                <input
                  type="range"
                  aria-label={t("surfaceSaturationLabel")}
                  className="app-range-slider h-2 w-full rounded-full"
                  style={rangeProgressStyle(
                    saturationNum,
                    SURFACE_SATURATION_BOUNDS.min,
                    SURFACE_SATURATION_BOUNDS.max
                  )}
                  min={SURFACE_SATURATION_BOUNDS.min}
                  max={SURFACE_SATURATION_BOUNDS.max}
                  step={5}
                  disabled={isSolid}
                  value={saturationNum}
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    setSaturationDraft(String(next))
                    previewLiveGlass({ surfaceSaturation: next })
                  }}
                />
              </div>
            </div>

            <label
              className={cn(
                "flex items-center gap-3 rounded-md border border-border bg-card/40 p-3 select-none",
                isSolid ? "cursor-not-allowed" : "cursor-pointer"
              )}
            >
              <Checkbox
                disabled={isSolid}
                checked={specularDraft}
                onCheckedChange={(val) => {
                  const nextSpec = val === true
                  setSpecularDraft(nextSpec)
                  previewLiveGlass({ surfaceSpecularBorder: nextSpec })
                }}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-body-sm font-medium text-foreground">
                  {t("surfaceSpecularLabel")}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("surfaceSpecularDesc")}
                </span>
              </div>
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isSolid}
                onClick={() => onPatchAppearance({ ...SURFACE_STYLE_PRESETS[appearance.surfaceStyle] })}
              >
                <RotateCcwIcon className="size-4" aria-hidden />
                {t("surfaceResetPresetCta")}
              </Button>
              <Button type="submit" size="sm" variant="secondary" disabled={isSolid || hasErrors}>
                {t("surfaceApplyTuningCta")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

export function AppearanceTab() {
  const t = useTranslations("settings.appearance")
  const tPresets = useTranslations("theme.presets")
  const tTheme = useTranslations("theme")
  const { appearance, behavior, snapshot, updatePreferences, applySnapshot } = useSettings()
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

  const handleUseLocalMedia = (assetPath: string) => {
    const nextMode = inferMediaKindFromAsset(assetPath)
    void updatePreferences({
      plugins: {
        enabled: true,
        entries: {
          [DEFAULT_WALLPAPER_PLUGIN_ID]: {
            enabled: true,
            source: "builtin",
            config: {
              ...wpConfig,
              mode: nextMode,
              mediaSource: "local",
              mediaAsset: assetPath,
            },
          },
        },
      },
    })
  }

  const handleApplyMediaUrl = (url: string) => {
    const nextMode = inferMediaKindFromUrl(url)
    void updatePreferences({
      plugins: {
        enabled: true,
        entries: {
          [DEFAULT_WALLPAPER_PLUGIN_ID]: {
            enabled: true,
            source: "builtin",
            config: {
              ...wpConfig,
              mode: nextMode,
              mediaSource: "url",
              mediaUrl: url,
            },
          },
        },
      },
    })
  }

  const handleSaveWallpaperTuning = (tuning: {
    blurPx: number
    dimOpacity: number
    surfaceOpacity: number
    speed: number
    pauseWhenHidden: boolean
  }) => {
    void updatePreferences({
      plugins: {
        enabled: true,
        entries: {
          [DEFAULT_WALLPAPER_PLUGIN_ID]: {
            enabled: activeMode !== "off",
            source: "builtin",
            config: {
              ...wpConfig,
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
          <div className="rounded-md border border-border bg-gradient-to-br from-primary/20 via-accent/35 to-success-soft/40 p-4">
            <div
              data-slot="glass-preview-panel"
              className="rounded-md border border-border bg-card p-4 text-card-foreground"
            >
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

      {/* Surface Translucency & Apple Liquid Glass */}
      <SurfaceMaterialCard
        key={JSON.stringify([
          appearance.surfaceStyle,
          appearance.surfaceOpacity,
          appearance.surfaceBlurPx,
          appearance.surfaceSaturation,
          appearance.surfaceSpecularBorder,
        ])}
        appearance={appearance}
        advancedMode={behavior.advancedMode}
        onPatchAppearance={patchAppearance}
      />

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
                <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-body-sm font-semibold text-foreground">
                      {t("wallpaperBuiltinSectionTitle")}
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {t("wallpaperBuiltinSectionDesc")}
                    </span>
                  </div>
                  <ToggleGroup
                    type="single"
                    value={activeMode === "image" || activeMode === "video" ? "" : activeMode}
                    onValueChange={(val) => {
                      if (val) handleSelectWallpaperMode(val)
                    }}
                  >
                    {BUILTIN_WALLPAPER_ANIMATION_MODES.map((mode) => (
                      <ToggleGroupItem key={mode} value={mode}>
                        {t(`wallpaperModes.${mode}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <CustomWallpaperMediaPanel
                  key={`${resolveWallpaperMediaSource(wpConfig)}|${String(wpConfig.mediaAsset ?? "")}|${String(wpConfig.mediaUrl ?? "")}`}
                  wpConfig={wpConfig}
                  activeMode={activeMode}
                  busy={wallpaperBusy}
                  onUploadLocalFile={handleUploadWallpaperMedia}
                  onUseLocalMedia={handleUseLocalMedia}
                  onApplyMediaUrl={handleApplyMediaUrl}
                />

                {behavior.advancedMode && (
                  <WallpaperTuningForm
                    key={JSON.stringify([
                      wpConfig.blurPx,
                      wpConfig.dimOpacity,
                      wpConfig.surfaceOpacity,
                      wpConfig.speed,
                      wpConfig.pauseWhenHidden,
                    ])}
                    wpConfig={wpConfig}
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
