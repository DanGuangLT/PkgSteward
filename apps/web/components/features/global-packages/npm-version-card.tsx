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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { globalActionPending } from "@/lib/global-packages/global-session"
import { npmVersionCard, npmVersionOptions } from "@/lib/global-packages/npm-version"
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
  const row = "grid min-w-0 gap-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-4"
  const button = "h-auto min-h-10 max-w-full border-border whitespace-normal"

  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4 rounded-md border border-border bg-background p-4">
    <div className="min-w-0 space-y-2">
      <h3 id={`${id}-title`} className="font-semibold">{t("npmVersion.title")}</h3>
      <p className="text-body-sm text-muted-foreground">{t("npmVersion.intro", { version: card.appVersion })}</p>
    </div>
    <dl className="min-w-0 divide-y divide-border rounded-md border border-border text-body-sm">
      <div className={row}><dt className="text-muted-foreground">{t("npmVersion.terminal")}</dt>
        <dd className="min-w-0 font-mono [overflow-wrap:anywhere]">{card.terminalVersion ?? t("unknown")}</dd></div>
      <div className={row}><dt className="text-muted-foreground">{t("npmVersion.app")}</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">{t("npmVersion.appValue", { version: card.appVersion })}</dd></div>
      <div className={row}><dt className="text-muted-foreground">{t("npmVersion.prefix")}</dt>
        <dd className="min-w-0 font-mono [overflow-wrap:anywhere]">{card.prefix}</dd></div>
      <div className={row}><dt className="text-muted-foreground">{t("npmVersion.statusLabel")}</dt>
        <dd className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
          <Badge variant="outline" className="h-auto min-h-6 max-w-full whitespace-normal">{t(`npmVersion.state.${card.state}`)}</Badge>
          {card.reason ? <p><GlobalCodeMessage code={card.reason} /></p> : null}
        </dd></div>
    </dl>
    {card.state === "broken" ? <p className="text-body-sm">{t("npmVersion.brokenHelp")}</p> : null}
    {card.canChange || card.canRestore || card.canRepair ? <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {card.canChange ? <Button type="button" variant="secondary" disabled={blocked} className={button}
        aria-busy={loadingVersions} aria-expanded={editing} aria-controls={`${id}-change`}
        onClick={() => {
          controller.select(editing ? { manager: "npm", package: "", action: "remove" } : change)
          if (!editing) void controller.loadVersions(NPM_SELF)
        }}><GlobalActionLabel pending={loadingVersions} icon={PencilIcon}>{t(loadingVersions ? "loadingVersions" : "change")}</GlobalActionLabel></Button> : null}
      {card.canRestore ? <Button type="button" variant="secondary" disabled={blocked} className={button} aria-busy={previewingRestore}
        onClick={event => onPreview({ ...NPM_SELF, action: "remove" }, event.currentTarget)}><GlobalActionLabel pending={previewingRestore} icon={RotateCcwIcon}>{t(previewingRestore ? "loadingPreview" : "npmVersion.restore")}</GlobalActionLabel></Button> : null}
      {card.canRepair ? <Button type="button" variant="secondary" disabled={blocked} className={button} aria-busy={previewingRepair}
        onClick={event => onPreview({ ...NPM_SELF, action: "repair" }, event.currentTarget)}><GlobalActionLabel pending={previewingRepair} icon={WrenchIcon}>{t(previewingRepair ? "loadingPreview" : "npmVersion.repair")}</GlobalActionLabel></Button> : null}
    </div> : null}
    {editing ? <div id={`${id}-change`} className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 [overflow-wrap:anywhere]">
      <p role="status" aria-live="polite" aria-atomic="true" className="text-body-sm">{loadingVersions ? t("loadingVersions") : options ? t("versionsReady") : t("versionsHint")}</p>
      <DiscoveryControls query={view.query} onQueryChange={query => setView({ query })} count={visible.matches.length} total={options?.length ?? 0} onReset={reset} />
      {options && visible.matches.length === 0 ? <DiscoveryEmpty total={options.length} /> : null}
      {options ? options.length ? <div className="min-w-0 space-y-2">
        <Label htmlFor={`${id}-versions`}>{t("availableVersions")}</Label>
        <select id={`${id}-versions`} value={chosen} disabled={blocked} aria-describedby={`${id}-hint`}
          className="min-h-10 w-full min-w-0 rounded-md border border-input bg-background p-2 font-mono text-body-sm focus-ring-input"
          onChange={event => controller.select({ ...change, targetVersion: event.target.value })}>
          <option value="">{t("chooseVersion")}</option>
          {visible.options.map(option => <option key={option.version} value={option.version} disabled={option.current}>
            {visible.selectedHidden && option.version === chosen ? d("selectedHidden", { version: option.version }) : option.current ? t("currentVersion", { version: option.version }) : option.version}</option>)}
        </select>
      </div> : <p className="text-body-sm">{t("npmVersion.noOptions")}</p> : null}
      <p id={`${id}-hint`} className="text-body-sm text-muted-foreground">{t("npmVersion.optionsHint")}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="secondary" disabled={blocked} className={button} aria-busy={loadingVersions}
          onClick={() => { void controller.loadVersions(NPM_SELF) }}><GlobalActionLabel pending={loadingVersions} icon={DownloadIcon}>{t(loadingVersions ? "loadingVersions" : "loadVersions")}</GlobalActionLabel></Button>
        <Button type="button" variant="secondary" disabled={blocked || !chosen} className={button} aria-busy={previewingChange}
          onClick={event => onPreview(change, event.currentTarget)}><GlobalActionLabel pending={previewingChange} icon={EyeIcon}>{t(previewingChange ? "loadingPreview" : "preview")}</GlobalActionLabel></Button>
      </div>
    </div> : null}
  </section>
}
