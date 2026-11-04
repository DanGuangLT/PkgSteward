"use client"

import { useId } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { GlobalController } from "@/components/features/global-packages/global-packages-panel"
import type { GlobalSelection } from "@/lib/global-packages/global-preview-form"
import type { GlobalManager, GlobalPackage } from "@/lib/global-packages/global-types"

export function GlobalPackageActions({ manager, pkg, controller, blocked, onPreview }: {
  manager: GlobalManager
  pkg: GlobalPackage
  controller: GlobalController
  blocked: boolean
  onPreview(selection: GlobalSelection, trigger: HTMLButtonElement): void
}) {
  const t = useTranslations("globalPackages")
  const id = useId()
  const selection = controller.state.form.selection
  const editing = selection.manager === manager && selection.package === pkg.name && selection.action === "change"
  const versions = controller.state.job?.status === "completed" ? controller.state.job.versions : null
  const options = versions?.manager === manager && versions.package === pkg.name ? versions : null
  const change: GlobalSelection = { manager, package: pkg.name, action: "change", targetVersion: editing ? selection.targetVersion ?? "" : "" }

  return <div className="min-w-0 space-y-3">
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Button type="button" variant="secondary" disabled={blocked} className="h-auto min-h-10 whitespace-normal"
        aria-label={t("removePackage", { name: pkg.name })}
        onClick={event => onPreview({ manager, package: pkg.name, action: "remove" }, event.currentTarget)}>{t("remove")}</Button>
      <Button type="button" variant="secondary" disabled={blocked} className="h-auto min-h-10 whitespace-normal"
        aria-expanded={editing} aria-controls={`${id}-change`} aria-label={t("changePackage", { name: pkg.name })}
        onClick={() => controller.select(editing ? { manager, package: "", action: "remove" } : change)}>{t("change")}</Button>
    </div>
    {editing ? <div id={`${id}-change`} className="min-w-0 space-y-3 rounded-md bg-muted p-4">
      <Label htmlFor={`${id}-target`}>{t("targetVersion")}</Label>
      <Input id={`${id}-target`} value={selection.targetVersion ?? ""} autoComplete="off" spellCheck={false}
        disabled={blocked} maxLength={256} className="min-w-0 font-mono" aria-describedby={`${id}-hint`}
        onChange={event => controller.select({ ...change, targetVersion: event.target.value })} />
      <p id={`${id}-hint`} className="text-body-sm text-muted-foreground">{t("versionHint")}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="secondary" disabled={blocked} className="h-auto min-h-10 whitespace-normal"
          onClick={() => { void controller.loadVersions({ manager, package: pkg.name }) }}>{t("loadVersions")}</Button>
        <Button type="button" variant="secondary" disabled={blocked || !selection.targetVersion?.trim()}
          className="h-auto min-h-10 whitespace-normal" onClick={event => onPreview(change, event.currentTarget)}>{t("preview")}</Button>
      </div>
      {options ? <div className="min-w-0 space-y-2">
        <Label htmlFor={`${id}-versions`}>{t("availableVersions")}</Label>
        <select id={`${id}-versions`} value="" disabled={blocked}
          className="min-h-10 w-full min-w-0 rounded-md border border-input bg-background p-2 text-body-sm focus-ring-input"
          onChange={event => { if (event.target.value) controller.select({ ...change, targetVersion: event.target.value }) }}>
          <option value="">{t("chooseVersion")}</option>
          <optgroup label={t("tags")}>{Object.entries(options.tags).map(([tag, version]) => <option key={tag} value={tag}>{tag} → {version}</option>)}</optgroup>
          <optgroup label={t("versions")}>{options.versions.map(version => <option key={version} value={version}>{version}</option>)}</optgroup>
        </select>
      </div> : null}
    </div> : null}
  </div>
}
