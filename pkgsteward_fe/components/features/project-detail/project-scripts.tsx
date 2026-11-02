"use client"

import { useTranslations } from "next-intl"

import type { ProjectScript } from "@/lib/api/types"

export function ProjectScripts({ scripts }: { scripts: readonly ProjectScript[] }) {
  const t = useTranslations("projectDetail")
  return (
    <section className="min-w-0 space-y-4" aria-label={t("scripts.title")}>
      <h2 className="text-heading-md">{t("scripts.title")}</h2>
      <p className="text-body-sm text-muted-foreground">{t("scripts.readOnly")}</p>
      {scripts.length === 0 ? <p className="text-body-sm">{t("scripts.empty")}</p> : (
        <dl className="min-w-0 space-y-3">{scripts.map(script => (
          <div key={script.name} className="min-w-0 rounded-md bg-muted p-4 text-body-sm [overflow-wrap:anywhere]">
            <dt className="font-mono font-semibold">{script.name}</dt>
            <dd className="mt-2 font-mono whitespace-pre-wrap">{script.command}</dd>
          </div>
        ))}</dl>
      )}
    </section>
  )
}
