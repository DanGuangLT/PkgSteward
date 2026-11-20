"use client"

import { useId } from "react"
import { DownloadIcon, EyeIcon, PencilIcon, RotateCcwIcon, WrenchIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { DiscoveryControls, DiscoveryEmpty } from "@/components/shared/list-discovery"
import { useViewState } from "@/hooks/use-navigation-continuity"
import { makeViewStateKey } from "@/lib/ui/navigation-targets"
import { TEXT_DISCOVERY, textDiscoveryCodec } from "@/lib/ui/discovery-state"
import { selectVersionOptions } from "@/lib/global-packages/discovery"
import { GlobalActionLabel, GlobalCodeMessage } from "@/components/features/global-packages/global-package-job"
import { DisabledTooltip } from "@/components/shared/disabled-tooltip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { globalActionPending } from "@/lib/global-packages/global-session"
import { npmVersionCard, npmVersionOptions } from "@/lib/global-packages/npm-version"
import { globalActionDisabledReason } from "@/lib/ui/disabled-reasons"
import type { GlobalController } from "@/components/features/global-packages/global-packages-panel"
import type { GlobalSelection } from "@/lib/global-packages/global-preview-form"
import type { GlobalManagerInventory } from "@/lib/global-packages/global-types"

const NPM_SELF = { manager: "npm", package: "npm" } as const

/** npm terminals run (overlay in the global folder) vs the Node-bundled npm PkgSteward keeps (U-80). */
export function NpmVersionCard({ inventory, controller, blocked, onPreview }: {
  inventory: GlobalManagerInventory
  controller: GlobalController
  blocked: boolean
  onPreview(selection: GlobalSelection, trigger: HTMLButtonElement): void
}) {
  const t = useTranslations("globalPackages")
  const tDisabled = useTranslations("disabledReasons")
  const id = useId()
  const d = useTranslations("listDiscovery")
  const [view, setView, reset] = useViewState(makeViewStateKey("npm-version-options", inventory.npmVersion?.prefix ?? inventory.globalRoot), textDiscoveryCodec, TEXT_DISCOVERY)
  const card = npmVersionCard(inventory)
  if (!card) return null
  const { state } = controller
  const selection = state.form.selection
  const editing = card.canChange && selection.manager === "npm" && selection.package === "npm" && selection.action === "change"
  const versions = state.versions?.manager === "npm" && state.versions.package === "npm" ? state.versions : null
  const options = versions ? npmVersionOptions(versions, card.terminalVersion) : null
  const chosen = options?.some(option => option.version === selection.targetVersion && !option.current) ? selection.targetVersion ?? "" : ""
  const visible = selectVersionOptions(options ?? [], view.query, versions?.tags ?? {}, chosen)
  const change: GlobalSelection = { ...NPM_SELF, action: "change", targetVersion: editing ? chosen : "" }
  const loadingVersions = globalActionPending(state, "versions", NPM_SELF)
  const previewingChange = globalActionPending(state, "preview", change)
  const previewingRestore = globalActionPending(state, "preview", { ...NPM_SELF, action: "remove" })
  const previewingRepair = globalActionPending(state, "preview", { ...NPM_SELF, action: "repair" })
  const button = "h-auto min-h-10 max-w-full border-border whitespace-normal"
  const stateBadgeVariant = card.state === "broken" ? "destructive"
    : card.state === "present" || card.state === "absent" ? "secondary" : "outline"
  const blockedReason = blocked ? tDisabled("globalBusy") : null
  const previewReasonKey = globalActionDisabledReason({
    blocked,
    needsVersion: true,
    hasVersion: Boolean(chosen),
  })
  const previewDisabledReason = previewReasonKey ? tDisabled(previewReasonKey) : null

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4 rounded-md border border-border bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-title`} className="text-body-md font-semibold text-foreground">{t("npmVersion.title")}</h3>
            <Badge variant={stateBadgeVariant} className="h-auto min-h-6 max-w-full whitespace-normal">
              {t(`npmVersion.state.${card.state}`)}
            </Badge>
          </div>
          <p className="text-caption text-muted-foreground">{t("npmVersion.intro", { version: card.appVersion })}</p>
        </div>

        {card.canChange || card.canRestore || card.canRepair ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {card.canChange ? (
              <DisabledTooltip reason={blockedReason}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={blocked}
                  className="h-auto min-h-9 max-w-full whitespace-normal"
                  aria-busy={loadingVersions}
                  aria-expanded={editing}
                  aria-controls={`${id}-change`}
                  onClick={() => {
                    controller.select(editing ? { manager: "npm", package: "", action: "remove" } : change)
                    if (!editing) void controller.loadVersions(NPM_SELF)
                  }}
                >
                  <GlobalActionLabel pending={loadingVersions} icon={PencilIcon}>
                    {t(loadingVersions ? "loadingVersions" : "change")}
                  </GlobalActionLabel>
                </Button>
              </DisabledTooltip>
            ) : null}
            {card.canRestore ? (
              <DisabledTooltip reason={blockedReason}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={blocked}
                  className="h-auto min-h-9 max-w-full whitespace-normal"
                  aria-busy={previewingRestore}
                  onClick={event => onPreview({ ...NPM_SELF, action: "remove" }, event.currentTarget)}
                >
                  <GlobalActionLabel pending={previewingRestore} icon={RotateCcwIcon}>
                    {t(previewingRestore ? "loadingPreview" : "npmVersion.restore")}
                  </GlobalActionLabel>
                </Button>
              </DisabledTooltip>
            ) : null}
            {card.canRepair ? (
              <DisabledTooltip reason={blockedReason}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={blocked}
                  className="h-auto min-h-9 max-w-full whitespace-normal"
                  aria-busy={previewingRepair}
                  onClick={event => onPreview({ ...NPM_SELF, action: "repair" }, event.currentTarget)}
                >
                  <GlobalActionLabel pending={previewingRepair} icon={WrenchIcon}>
                    {t(previewingRepair ? "loadingPreview" : "npmVersion.repair")}
                  </GlobalActionLabel>
                </Button>
              </DisabledTooltip>
            ) : null}
          </div>
        ) : null}
      </div>

      <dl className="grid min-w-0 gap-3 rounded-md border border-border bg-card p-3.5 text-body-sm sm:grid-cols-3">
        <div className="min-w-0 space-y-0.5">
          <dt className="text-caption text-muted-foreground">{t("npmVersion.terminal")}</dt>
          <dd className="min-w-0 font-mono font-medium text-foreground [overflow-wrap:anywhere]">
            {card.terminalVersion ?? t("unknown")}
          </dd>
        </div>
        <div className="min-w-0 space-y-0.5">
          <dt className="text-caption text-muted-foreground">{t("npmVersion.app")}</dt>
          <dd className="min-w-0 text-caption text-foreground [overflow-wrap:anywhere]">
            {t("npmVersion.appValue", { version: card.appVersion })}
          </dd>
        </div>
        <div className="min-w-0 space-y-0.5">
          <dt className="text-caption text-muted-foreground">{t("npmVersion.prefix")}</dt>
          <dd className="min-w-0 font-mono text-caption text-foreground [overflow-wrap:anywhere]">
            {card.prefix}
          </dd>
        </div>
      </dl>

      {card.reason ? (
        <p className="text-caption text-muted-foreground">
          <span className="sr-only">{t("npmVersion.statusLabel")}: </span>
          <GlobalCodeMessage code={card.reason} />
        </p>
      ) : null}

      {card.state === "broken" ? (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-body-sm font-medium text-warning">
          {t("npmVersion.brokenHelp")}
        </p>
      ) : null}

      {editing ? (
        <div id={`${id}-change`} className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 [overflow-wrap:anywhere]">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-body-sm">
            {loadingVersions ? t("loadingVersions") : options ? t("versionsReady") : t("versionsHint")}
          </p>
          <DiscoveryControls query={view.query} onQueryChange={query => setView({ query })} count={visible.matches.length} total={options?.length ?? 0} onReset={reset} />
          {options && visible.matches.length === 0 ? <DiscoveryEmpty total={options.length} /> : null}
          {options ? options.length ? (
            <div className="min-w-0 space-y-2">
              <Label htmlFor={`${id}-versions`}>{t("availableVersions")}</Label>
              <select
                id={`${id}-versions`}
                value={chosen}
                disabled={blocked}
                aria-describedby={`${id}-hint`}
                className="min-h-10 w-full min-w-0 rounded-md border border-input bg-background p-2 font-mono text-body-sm focus-ring-input"
                onChange={event => controller.select({ ...change, targetVersion: event.target.value })}
              >
                <option value="">{t("chooseVersion")}</option>
                {visible.options.map(option => (
                  <option key={option.version} value={option.version} disabled={option.current}>
                    {visible.selectedHidden && option.version === chosen
                      ? d("selectedHidden", { version: option.version })
                      : option.current
                        ? t("currentVersion", { version: option.version })
                        : option.version}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-body-sm">{t("npmVersion.noOptions")}</p>
          ) : null}
          <p id={`${id}-hint`} className="text-caption text-muted-foreground">{t("npmVersion.optionsHint")}</p>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
            <DisabledTooltip reason={blockedReason}>
              <Button type="button" variant="secondary" disabled={blocked} className={button} aria-busy={loadingVersions}
                onClick={() => { void controller.loadVersions(NPM_SELF) }}>
                <GlobalActionLabel pending={loadingVersions} icon={DownloadIcon}>{t(loadingVersions ? "loadingVersions" : "loadVersions")}</GlobalActionLabel>
              </Button>
            </DisabledTooltip>
            <DisabledTooltip reason={previewDisabledReason}>
              <Button type="button" variant="secondary" disabled={blocked || !chosen} className={button} aria-busy={previewingChange}
                onClick={event => onPreview(change, event.currentTarget)}>
                <GlobalActionLabel pending={previewingChange} icon={EyeIcon}>{t(previewingChange ? "loadingPreview" : "preview")}</GlobalActionLabel>
              </Button>
            </DisabledTooltip>
          </div>
        </div>
      ) : null}
    </section>
  )
}
