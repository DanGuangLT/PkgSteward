"use client"

import { useRef, useState } from "react"
import { RefreshCwIcon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"

import { GlobalPackagesList } from "@/components/features/global-packages/global-packages-list"
import { GlobalPackagePreview } from "@/components/features/global-packages/global-package-preview"
import { GlobalActionLabel, GlobalCodeMessage, GlobalPackageJob } from "@/components/features/global-packages/global-package-job"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useGlobalPackages } from "@/hooks/use-global-packages"
import { isRunActive } from "@/lib/npm-runner/runner-policy"
import { globalActionPending, globalMutationSucceeded } from "@/lib/global-packages/global-session"
import type { GlobalSelection } from "@/lib/global-packages/global-preview-form"
import type { GlobalJob, GlobalSnapshot } from "@/lib/global-packages/global-types"

export type GlobalController = ReturnType<typeof useGlobalPackages>

// The session refreshes inventory after success; retain the displayed rows after failure.
const retainInventory = () => {}

export function GlobalPackagesPanel({ snapshot, latest }: { snapshot: GlobalSnapshot | null; latest: GlobalJob | null }) {
  const t = useTranslations("globalPackages")
  const format = useFormatter()
  const controller = useGlobalPackages(snapshot, latest, retainInventory)
  const { state } = controller
  const [tab, setTab] = useState<string>(snapshot?.managers[0]?.manager ?? "npm")
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const inventoryHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const managers = state.snapshot?.managers ?? []
  const refreshingInventory = globalActionPending(state, "inventory")
  const result = state.mutationResult
  const succeeded = result !== null && globalMutationSucceeded(result)
  const activeTab = managers.some(item => item.manager === tab) ? tab : managers[0]?.manager
  const blocked = state.phase !== "idle" || state.startUnknown || state.cancelUnknown || state.cancelPending
    || state.refreshing || (state.job !== null && isRunActive(state.job))
    || state.error?.code === "RUNNING" || state.error?.code === "READERS_RUNNING"

  function preview(selection: GlobalSelection, trigger: HTMLButtonElement) {
    returnFocusRef.current = trigger
    void controller.preview(selection)
  }

  return <div className="min-w-0 space-y-6">
    <div role="status" aria-live="polite" aria-atomic="true">
      {result ? <div className="space-y-2 rounded-md border border-border bg-muted p-4 text-body-sm">
        <p className="font-semibold">{t(succeeded ? "outcome.success" : "outcome.failure", { name: result.package ?? t("package") })}</p>
        {result.failureCode ? <p><GlobalCodeMessage code={result.failureCode} /></p> : null}
        {!succeeded ? <p>{t(result.mutationSpawned ? "job.mayHaveChanged" : "outcome.unchanged")}</p> : <p>{t("outcome.refreshHint")}</p>}
      </div> : null}
    </div>
    <section aria-label={t("inventory")} className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 ref={inventoryHeadingRef} tabIndex={-1} className="rounded-sm text-heading-lg focus-ring">{t("inventory")}</h2>
        <Button type="button" variant="secondary" disabled={blocked} aria-busy={refreshingInventory}
          className="h-auto min-h-10 border-border whitespace-normal" onClick={() => { void controller.inventory() }}><GlobalActionLabel pending={refreshingInventory} icon={RefreshCwIcon}>{t(refreshingInventory ? "loadingInventory" : "refresh")}</GlobalActionLabel></Button>
      </div>
      <p className="text-body-sm text-muted-foreground">{t("refreshHint")}</p>
      <p className="text-body-sm text-muted-foreground">{t("yarnUnsupported")}</p>
      {state.snapshot ? <div className="flex flex-wrap items-center gap-3 text-body-sm">
        <p>{t("asOf", { time: format.dateTime(new Date(state.snapshot.asOf), { dateStyle: "medium", timeStyle: "short" }) })}</p>
        {state.snapshot.stale ? <Badge variant="outline">{t("stale")}</Badge> : null}
      </div> : <p className="text-body-sm">{t("noInventory")}</p>}
      {state.snapshotError ? <p role="alert" className="text-body-sm"><GlobalCodeMessage code={state.snapshotError} /></p> : null}
      {managers.length ? <Tabs value={activeTab} onValueChange={value => {
        setTab(value)
        if (value === "npm" || value === "pnpm") controller.select({ manager: value, package: "", action: "remove" })
      }} className="min-w-0">
        <TabsList aria-label={t("manager")}>
          {managers.map(item => <TabsTrigger key={item.manager} value={item.manager} disabled={blocked}>{item.manager}</TabsTrigger>)}
        </TabsList>
        {managers.map(item => <TabsContent key={item.manager} value={item.manager} className="min-w-0 pt-4">
          <div className="min-w-0 rounded-md border border-border bg-background">
            <dl className="min-w-0 divide-y divide-border border-b border-border text-body-sm">
              <div className="grid min-w-0 gap-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-4"><dt className="text-muted-foreground">{t("managerVersion")}</dt><dd className="min-w-0 font-mono [overflow-wrap:anywhere]">{item.version ?? t("unknown")}</dd></div>
              <div className="grid min-w-0 gap-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-4"><dt className="text-muted-foreground">{t("globalRoot")}</dt><dd className="min-w-0 font-mono [overflow-wrap:anywhere]">{item.globalRoot ?? t("unknown")}</dd></div>
              <div className="grid min-w-0 gap-1 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-4"><dt className="text-muted-foreground">{t("binDir")}</dt><dd className="min-w-0 font-mono [overflow-wrap:anywhere]">{item.binDir ?? t("unknown")}</dd></div>
            </dl>
            <div className="min-w-0 p-4">
              {item.available ? <GlobalPackagesList inventory={item} controller={controller} blocked={blocked} onPreview={preview} />
                : <p className="text-body-sm [overflow-wrap:anywhere]">{t("unavailable")} <GlobalCodeMessage code={item.reason ?? "UNKNOWN"} /></p>}
            </div>
          </div>
        </TabsContent>)}
      </Tabs> : state.snapshot ? <p className="text-body-sm">{t("noManagers")}</p> : null}
    </section>
    <GlobalPackageJob controller={controller} />
    {state.form.preview ? <GlobalPackagePreview key={state.form.preview.previewId} controller={controller}
      blocked={blocked} returnFocusRef={returnFocusRef} fallbackFocusRef={inventoryHeadingRef} onCancel={() => {
        // Reset preview and consent while retaining the editor and its focus target.
        controller.select({ ...state.form.selection, package: "" })
        controller.select(state.form.selection)
      }} /> : null}
  </div>
}
