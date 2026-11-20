"use client"

import { useLocale, useTranslations } from "next-intl"
import { DiscoveryControls, DiscoveryFilter, DiscoverySort, DiscoveryEmpty } from "@/components/shared/list-discovery"
import { useViewState } from "@/hooks/use-navigation-continuity"
import { makeViewStateKey } from "@/lib/ui/navigation-targets"
import { GLOBAL_DISCOVERY, GLOBAL_STATUSES, globalDiscoveryCodec, selectGlobalPackages } from "@/lib/global-packages/discovery"
import { Badge } from "@/components/ui/badge"
import { GlobalPackageActions } from "@/components/features/global-packages/global-package-actions"
import { GlobalCodeMessage } from "@/components/features/global-packages/global-package-job"
import type { GlobalController } from "@/components/features/global-packages/global-packages-panel"
import type { GlobalSelection } from "@/lib/global-packages/global-preview-form"
import type { GlobalManagerInventory } from "@/lib/global-packages/global-types"

export function GlobalPackagesList({ inventory, controller, blocked, onPreview }: {
  inventory: GlobalManagerInventory
  controller: GlobalController
  blocked: boolean
  onPreview(selection: GlobalSelection, trigger: HTMLButtonElement): void
}) {
  const t = useTranslations("globalPackages")
  const d = useTranslations("listDiscovery")
  const locale = useLocale()
  const [view, setView, reset] = useViewState(makeViewStateKey("global-packages", JSON.stringify([inventory.manager, inventory.globalRoot])), globalDiscoveryCodec, GLOBAL_DISCOVERY)
  const rows = selectGlobalPackages(inventory.packages, view, locale)

  return (
    <div className="min-w-0 space-y-4">
      <DiscoveryControls query={view.query} onQueryChange={query => setView({ ...view, query })} count={rows.length} total={inventory.packages.length} onReset={reset}>
        <DiscoveryFilter label={d("statuses")} value={view.statuses} options={GLOBAL_STATUSES.map(value => ({ value, label: d(`values.${value}`), count: inventory.packages.filter(row => row.status === value).length }))} onValueChange={statuses => setView({ ...view, statuses })} />
        <DiscoverySort value={view.sort} options={[{ value: "name", label: d("name") }, { value: "version", label: d("version") }]} onValueChange={sort => setView({ ...view, sort })} />
      </DiscoveryControls>
      <div className="min-w-0 overflow-hidden rounded-md border border-border bg-card text-card-foreground">
        <div aria-hidden="true" className="hidden min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,1fr)_minmax(0,1.5fr)] gap-4 border-b border-border bg-muted px-4 py-3 text-caption font-semibold md:grid">
          <span>{t("package")}</span><span>{t("version")}</span><span>{t("statusLabel")}</span><span>{t("actions")}</span>
        </div>
        {rows.length ? (
          <ul role="list" className="min-w-0 divide-y divide-border" aria-label={t("inventory")}>
            {rows.map(pkg => {
              const manageable = pkg.status === "manageable" && pkg.reason === null
              // npm itself is managed by the npm version card above the list (M9G).
              const npmSelf = inventory.manager === "npm" && pkg.name === "npm"
              return (
                <li key={pkg.name} className="grid min-w-0 gap-4 p-4 text-body-sm transition-colors hover:bg-muted/30 md:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
                  <div className="min-w-0 space-y-1.5">
                    <h3 className="font-semibold text-foreground [overflow-wrap:anywhere]">{pkg.name}</h3>
                    <dl className="min-w-0 text-caption">
                      <dt className="text-muted-foreground">{t("bins")}</dt>
                      <dd className="font-mono text-foreground [overflow-wrap:anywhere]">{pkg.bins.length ? pkg.bins.map(bin => bin.name).join(", ") : t("none")}</dd>
                    </dl>
                  </div>
                  <dl className="min-w-0">
                    <dt className="text-caption text-muted-foreground md:sr-only">{t("version")}</dt>
                    <dd className="font-mono tabular-nums [overflow-wrap:anywhere]">{pkg.version}</dd>
                  </dl>
                  <dl className="min-w-0">
                    <dt className="text-caption text-muted-foreground md:sr-only">{t("statusLabel")}</dt>
                    <dd className="space-y-1.5 [overflow-wrap:anywhere]">
                      <Badge variant={manageable ? "success" : "outline"} className="h-auto min-h-6 max-w-full whitespace-normal">
                        {t(manageable ? "ready" : `packageStatus.${pkg.status}`)}
                      </Badge>
                      {npmSelf ? <p className="text-caption text-muted-foreground">{t("npmVersion.listHint")}</p>
                        : !manageable ? <p className="text-caption text-muted-foreground"><GlobalCodeMessage code={pkg.reason ?? (pkg.status === "linked" ? "LINKED_PACKAGE" : pkg.status === "protected" ? "PROTECTED_PACKAGE" : "UNKNOWN")} /></p> : null}
                    </dd>
                  </dl>
                  <div className="min-w-0 space-y-2">
                    <p className="text-caption text-muted-foreground md:sr-only">{t("actions")}</p>
                    {manageable ? (
                      <GlobalPackageActions manager={inventory.manager} pkg={pkg} controller={controller} blocked={blocked} onPreview={onPreview} />
                    ) : (
                      <p className="text-caption text-muted-foreground">{t("packageStatus.manageable")}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="p-4"><DiscoveryEmpty total={inventory.packages.length} /></div>
        )}
      </div>
    </div>
  )
}
