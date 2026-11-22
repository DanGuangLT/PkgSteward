"use client"

import { useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { DiscoveryControls, DiscoveryEmpty } from "@/components/shared/list-discovery"
import { ListPagination, useListPagination } from "@/components/shared/list-pagination"
import { useViewState } from "@/hooks/use-navigation-continuity"
import { makeViewStateKey } from "@/lib/ui/navigation-targets"
import { TEXT_DISCOVERY, textDiscoveryCodec } from "@/lib/ui/discovery-state"
import { selectScripts } from "@/lib/projects/detail-filters"

import type { ProjectScript } from "@/lib/api/types"

export function ProjectScripts({ scripts, resourceKey }: { scripts: readonly ProjectScript[]; resourceKey?: string }) {
  const t = useTranslations("projectDetail")
  const locale = useLocale()
  const persisted = useViewState(makeViewStateKey("project-scripts", resourceKey), textDiscoveryCodec, TEXT_DISCOVERY)
  const [local, setLocal] = useState(TEXT_DISCOVERY)
  const [view, setView, reset] = resourceKey ? persisted : [local, setLocal, () => setLocal(TEXT_DISCOVERY)] as const
  const visible = selectScripts(scripts, view.query, locale)
  const listAnchorRef = useRef<HTMLDivElement | null>(null)
  const scriptsResetKey = useMemo(() => JSON.stringify([resourceKey ?? "", view]), [resourceKey, view])
  const scriptsPagination = useListPagination(visible, {
    resetKey: scriptsResetKey,
    scrollTargetRef: listAnchorRef,
  })
  return (
    <section className="min-w-0 space-y-4" aria-label={t("scripts.title")}>
      <h2 className="text-heading-md">{t("scripts.title")}</h2>
      <p className="text-body-sm text-muted-foreground">{t("scripts.readOnly")}</p>
      <DiscoveryControls query={view.query} onQueryChange={query => setView({ query })} count={visible.length} total={scripts.length} onReset={reset} />
      {visible.length === 0 ? <DiscoveryEmpty total={scripts.length} /> : (
        <div ref={listAnchorRef} className="min-w-0 scroll-mt-20 space-y-4">
          <dl className="min-w-0 space-y-3">{scriptsPagination.items.map(script => (
            <div key={script.name} className="min-w-0 rounded-md bg-muted p-4 text-body-sm [overflow-wrap:anywhere]">
              <dt className="font-mono font-semibold">{script.name}</dt>
              <dd className="mt-2 font-mono whitespace-pre-wrap">{script.command}</dd>
            </div>
          ))}</dl>
          <ListPagination
            meta={scriptsPagination.meta}
            pageSize={scriptsPagination.pageSize}
            showPageSizeSelector={scriptsPagination.showPageSizeSelector}
            onPageChange={scriptsPagination.setPage}
            onPageSizeChange={scriptsPagination.setPageSize}
          />
        </div>
      )}
    </section>
  )
}
