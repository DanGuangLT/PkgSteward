"use client"

import { useTranslations } from "next-intl"
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
  if (!inventory.packages.length) return <p className="text-body-sm">{t("empty")}</p>
  return <ul className="min-w-0 divide-y divide-border" aria-label={t("inventory")}>
    {inventory.packages.map(pkg => <li key={pkg.name} className="min-w-0 space-y-3 py-4">
      <h3 className="break-all text-heading-md">{pkg.name}</h3>
      <dl className="grid min-w-0 gap-3 text-body-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-muted-foreground">{t("version")}</dt><dd className="break-all font-mono">{pkg.version}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">{t("bins")}</dt><dd className="break-all font-mono">{pkg.bins.length ? pkg.bins.map(bin => bin.name).join(", ") : t("none")}</dd></div>
      </dl>
      {pkg.status === "manageable" && pkg.reason === null ? <GlobalPackageActions manager={inventory.manager} pkg={pkg}
        controller={controller} blocked={blocked} onPreview={onPreview} />
        : <p className="text-body-sm">{t(`packageStatus.${pkg.status}`)} <GlobalCodeMessage code={pkg.reason ?? (pkg.status === "linked" ? "LINKED_PACKAGE" : pkg.status === "protected" ? "PROTECTED_PACKAGE" : "UNKNOWN")} /></p>}
    </li>)}
  </ul>
}
