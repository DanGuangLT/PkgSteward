"use client"

import { CheckIcon, MonitorIcon, MoonIcon, PanelLeftIcon, PanelTopIcon, SunIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { useSettings } from "@/components/settings/settings-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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
import type {
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

export function AppearanceTab() {
  const t = useTranslations("settings.appearance")
  const tPresets = useTranslations("theme.presets")
  const tTheme = useTranslations("theme")
  const { appearance, updatePreferences } = useSettings()

  const patchAppearance = (patch: Partial<typeof appearance>) => {
    void updatePreferences({ appearance: patch })
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

          {appearance.navigationLayout === "sidebar" && (
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

          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
            <Checkbox
              checked={appearance.showBreadcrumbs}
              onCheckedChange={(val) => patchAppearance({ showBreadcrumbs: val === true })}
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-body-sm font-medium text-foreground">
                {t("showBreadcrumbsLabel")}
              </span>
              <span className="text-caption text-muted-foreground">
                {t("showBreadcrumbsDesc")}
              </span>
            </div>
          </label>
        </CardContent>
      </Card>

      {/* Accessibility */}
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
    </div>
  )
}
