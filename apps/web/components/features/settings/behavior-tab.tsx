"use client"

import { useTranslations } from "next-intl"

import { IS_DEV_ENVIRONMENT } from "@/components/layout/nav-items"
import { useSettings } from "@/components/settings/settings-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  SettingsConsoleShell,
  SettingsDateFormat,
  SettingsLocale,
  SettingsPageSize,
} from "@/lib/settings/types"

const LOCALES: readonly SettingsLocale[] = ["vi", "en"]
const SHELLS: readonly SettingsConsoleShell[] = ["cmd", "powershell"]
const PAGE_SIZES: readonly SettingsPageSize[] = [10, 25, 50, 100]
const DATE_FORMATS: readonly SettingsDateFormat[] = ["relative", "absolute", "iso"]

export function BehaviorTab() {
  const t = useTranslations("settings.behavior")
  const { behavior, updatePreferences } = useSettings()

  const patchBehavior = (patch: Partial<typeof behavior>) => {
    void updatePreferences({ behavior: patch })
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("generalTitle")}</CardTitle>
          <CardDescription>{t("generalDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>{t("localeLabel")}</Label>
            <ToggleGroup
              type="single"
              value={behavior.locale}
              onValueChange={(val) => {
                if (val && LOCALES.includes(val as SettingsLocale)) {
                  patchBehavior({ locale: val as SettingsLocale })
                }
              }}
            >
              {LOCALES.map((loc) => (
                <ToggleGroupItem key={loc} value={loc}>
                  {t(`locales.${loc}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("defaultShellLabel")}</Label>
            <ToggleGroup
              type="single"
              value={behavior.defaultConsoleShell}
              onValueChange={(val) => {
                if (val && SHELLS.includes(val as SettingsConsoleShell)) {
                  patchBehavior({ defaultConsoleShell: val as SettingsConsoleShell })
                }
              }}
            >
              {SHELLS.map((shell) => (
                <ToggleGroupItem key={shell} value={shell} className="font-mono">
                  {t(`shells.${shell}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-caption text-muted-foreground">{t("defaultShellHint")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("defaultPageSizeLabel")}</Label>
            <ToggleGroup
              type="single"
              value={String(behavior.defaultPageSize)}
              onValueChange={(val) => {
                const parsed = Number(val)
                if (val && PAGE_SIZES.includes(parsed as SettingsPageSize)) {
                  patchBehavior({ defaultPageSize: parsed as SettingsPageSize })
                }
              }}
            >
              {PAGE_SIZES.map((size) => (
                <ToggleGroupItem key={size} value={String(size)}>
                  {size}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {behavior.advancedMode && (
            <div className="flex flex-col gap-2">
              <Label>{t("dateFormatLabel")}</Label>
              <ToggleGroup
                type="single"
                value={behavior.dateFormat}
                onValueChange={(val) => {
                  if (val && DATE_FORMATS.includes(val as SettingsDateFormat)) {
                    patchBehavior({ dateFormat: val as SettingsDateFormat })
                  }
                }}
              >
                {DATE_FORMATS.map((fmt) => (
                  <ToggleGroupItem key={fmt} value={fmt}>
                    {t(`dateFormats.${fmt}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("workflowTitle")}</CardTitle>
          <CardDescription>{t("workflowDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
            <Checkbox
              checked={behavior.autoRefreshOnFocus}
              onCheckedChange={(val) => patchBehavior({ autoRefreshOnFocus: val === true })}
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-body-sm font-medium text-foreground">
                {t("autoRefreshLabel")}
              </span>
              <span className="text-caption text-muted-foreground">{t("autoRefreshDesc")}</span>
            </div>
          </label>

          {behavior.advancedMode && (
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
              <Checkbox
                checked={behavior.confirmBeforeNavigation}
                onCheckedChange={(val) => patchBehavior({ confirmBeforeNavigation: val === true })}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-body-sm font-medium text-foreground">
                  {t("confirmNavigationLabel")}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("confirmNavigationDesc")}
                </span>
              </div>
            </label>
          )}

          {behavior.advancedMode && IS_DEV_ENVIRONMENT && (
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 select-none">
              <Checkbox
                checked={behavior.showDesignSystemInNav}
                onCheckedChange={(val) => patchBehavior({ showDesignSystemInNav: val === true })}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-body-sm font-medium text-foreground">
                  {t("showDesignSystemLabel")}
                </span>
                <span className="text-caption text-muted-foreground">
                  {t("showDesignSystemDesc")}
                </span>
              </div>
            </label>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
