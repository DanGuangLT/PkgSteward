"use client"

import { useCallback, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { useRouter } from "next/navigation"

import { GlobalPackagesList } from "@/components/features/global-packages/global-packages-list"
import { GlobalPackagePreview } from "@/components/features/global-packages/global-package-preview"
import { GlobalCodeMessage, GlobalPackageJob } from "@/components/features/global-packages/global-package-job"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useGlobalPackages } from "@/hooks/use-global-packages"
import { isRunActive } from "@/lib/npm-runner/runner-policy"
import type { GlobalSelection } from "@/lib/global-packages/global-preview-form"
import type { GlobalJob, GlobalSnapshot } from "@/lib/global-packages/global-types"

export type GlobalController = ReturnType<typeof useGlobalPackages>

export function GlobalPackagesPanel({ snapshot, latest }: { snapshot: GlobalSnapshot | null; latest: GlobalJob | null }) {
  const t = useTranslations("globalPackages")
  const format = useFormatter()
  const router = useRouter()
  const onMutated = useCallback(() => router.refresh(), [router])
  const controller = useGlobalPackages(snapshot, latest, onMutated)
  const { state } = controller
  const [tab, setTab] = useState<string>(snapshot?.managers[0]?.manager ?? "npm")
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const inventoryHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const managers = state.snapshot?.managers ?? []
  const activeTab = managers.some(item => item.manager === tab) ? tab : managers[0]?.manager
  const blocked = state.phase !== "idle" || state.startUnknown || state.cancelUnknown || state.cancelPending
    || state.refreshing || (state.job !== null && isRunActive(state.job))
    || state.error?.code === "RUNNING" || state.error?.code === "READERS_RUNNING"

  function preview(selection: GlobalSelection, trigger: HTMLButtonElement) {
    returnFocusRef.current = trigger
    void controller.preview(selection)
  }

  return <div className="min-w-0 space-y-6">
    <section aria-label={t("inventory")} className="min-w-0 space-y-4 rounded-md border border-border bg-card p-4 text-card-foreground md:p-6">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 ref={inventoryHeadingRef} tabIndex={-1} className="rounded-sm text-heading-lg focus-ring">{t("inventory")}</h2>
        <Button type="button" variant="secondary" disabled={blocked}
          className="h-auto min-h-10 whitespace-normal" onClick={() => { void controller.inventory() }}>{t("refresh")}</Button>
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
          {managers.map(item => <TabsTrigger key={item.manager} value={item.manager}>{item.manager}</TabsTrigger>)}
        </TabsList>
        {managers.map(item => <TabsContent key={item.manager} value={item.manager} className="min-w-0 space-y-4 pt-4">
          <dl className="grid min-w-0 gap-3 text-body-sm sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-muted-foreground">{t("managerVersion")}</dt><dd className="break-all font-mono">{item.version ?? t("unknown")}</dd></div>
            <div className="min-w-0"><dt className="text-muted-foreground">{t("globalRoot")}</dt><dd className="break-all font-mono">{item.globalRoot ?? t("unknown")}</dd></div>
            <div className="min-w-0"><dt className="text-muted-foreground">{t("binDir")}</dt><dd className="break-all font-mono">{item.binDir ?? t("unknown")}</dd></div>
          </dl>
          {item.available ? <GlobalPackagesList inventory={item} controller={controller} blocked={blocked} onPreview={preview} />
            : <p className="text-body-sm">{t("unavailable")} <GlobalCodeMessage code={item.reason ?? "UNKNOWN"} /></p>}
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
