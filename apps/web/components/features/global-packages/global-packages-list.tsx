"use client"

import { useTranslations } from "next-intl"
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
  return <div className="min-w-0 rounded-md border border-border bg-card text-card-foreground">
    <div aria-hidden="true" className="hidden min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,1fr)_minmax(0,1.5fr)] gap-4 rounded-t-md border-b border-border bg-muted px-4 py-3 text-body-sm font-semibold md:grid">
      <span>{t("package")}</span><span>{t("version")}</span><span>{t("statusLabel")}</span><span>{t("actions")}</span>
    </div>
    {inventory.packages.length ? <ul role="list" className="min-w-0 divide-y divide-border" aria-label={t("inventory")}>
      {inventory.packages.map(pkg => {
        const manageable = pkg.status === "manageable" && pkg.reason === null
        return <li key={pkg.name} className="grid min-w-0 gap-4 p-4 text-body-sm md:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
          <div className="min-w-0 space-y-2">
            <h3 className="font-semibold [overflow-wrap:anywhere]">{pkg.name}</h3>
            <dl className="min-w-0">
              <dt className="text-muted-foreground">{t("bins")}</dt>
              <dd className="font-mono [overflow-wrap:anywhere]">{pkg.bins.length ? pkg.bins.map(bin => bin.name).join(", ") : t("none")}</dd>
            </dl>
          </div>
          <dl className="min-w-0">
            <dt className="text-muted-foreground md:sr-only">{t("version")}</dt>
            <dd className="font-mono [overflow-wrap:anywhere]">{pkg.version}</dd>
          </dl>
          <dl className="min-w-0">
            <dt className="text-muted-foreground md:sr-only">{t("statusLabel")}</dt>
            <dd className="space-y-2 [overflow-wrap:anywhere]">
              <Badge variant="outline" className="h-auto min-h-6 max-w-full whitespace-normal">{t(manageable ? "ready" : `packageStatus.${pkg.status}`)}</Badge>
              {!manageable ? <p><GlobalCodeMessage code={pkg.reason ?? (pkg.status === "linked" ? "LINKED_PACKAGE" : pkg.status === "protected" ? "PROTECTED_PACKAGE" : "UNKNOWN")} /></p> : null}
            </dd>
          </dl>
          <div className="min-w-0 space-y-2">
            <p className="text-muted-foreground md:sr-only">{t("actions")}</p>
            {manageable ? <GlobalPackageActions manager={inventory.manager} pkg={pkg}
              controller={controller} blocked={blocked} onPreview={onPreview} />
              : <p>{t("packageStatus.manageable")}</p>}
          </div>
        </li>
      })}
    </ul> : <p className="p-4 text-body-sm">{t("empty")}</p>}
  </div>
}
