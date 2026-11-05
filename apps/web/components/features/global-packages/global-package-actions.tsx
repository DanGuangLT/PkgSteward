"use client"

import { useId } from "react"
import { DownloadIcon, EyeIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GlobalActionLabel } from "@/components/features/global-packages/global-package-job"
import { globalActionPending } from "@/lib/global-packages/global-session"
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
  const versions = controller.state.versions
  const options = versions?.manager === manager && versions.package === pkg.name ? versions : null
  const change: GlobalSelection = { manager, package: pkg.name, action: "change", targetVersion: editing ? selection.targetVersion ?? "" : "" }
  const loadingVersions = globalActionPending(controller.state, "versions", change)
  const previewingChange = globalActionPending(controller.state, "preview", change)
  const previewingRemove = globalActionPending(controller.state, "preview", { ...change, action: "remove" })
  const chosen = selection.targetVersion ?? ""
  const chosenOption = options && (options.versions.includes(chosen) || Object.hasOwn(options.tags, chosen)) ? chosen : ""

  return <div className="min-w-0 space-y-3">
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Button type="button" variant="secondary" disabled={blocked} className="h-auto min-h-10 max-w-full border-border whitespace-normal"
        aria-busy={previewingRemove} aria-label={previewingRemove ? `${t("loadingPreview")} ${pkg.name}` : t("removePackage", { name: pkg.name })}
        onClick={event => onPreview({ manager, package: pkg.name, action: "remove" }, event.currentTarget)}><GlobalActionLabel pending={previewingRemove} icon={Trash2Icon}>{t(previewingRemove ? "loadingPreview" : "remove")}</GlobalActionLabel></Button>
      <Button type="button" variant="secondary" disabled={blocked} className="h-auto min-h-10 max-w-full border-border whitespace-normal"
        aria-busy={loadingVersions} aria-expanded={editing} aria-controls={`${id}-change`}
        aria-label={loadingVersions ? `${t("loadingVersions")} ${pkg.name}` : t("changePackage", { name: pkg.name })}
        onClick={() => {
          controller.select(editing ? { manager, package: "", action: "remove" } : change)
          if (!editing) void controller.loadVersions({ manager, package: pkg.name })
        }}><GlobalActionLabel pending={loadingVersions} icon={PencilIcon}>{t(loadingVersions ? "loadingVersions" : "change")}</GlobalActionLabel></Button>
    </div>
    {editing ? <div id={`${id}-change`} className="min-w-0 space-y-3 rounded-md border border-border bg-muted p-4 [overflow-wrap:anywhere]">
      <p role="status" aria-live="polite" aria-atomic="true" className="text-body-sm">{loadingVersions ? t("loadingVersions") : options ? t("versionsReady") : t("versionsHint")}</p>
      {options ? <div className="min-w-0 space-y-2">
        <Label htmlFor={`${id}-versions`}>{t("availableVersions")}</Label>
        <select id={`${id}-versions`} value={chosenOption} disabled={blocked}
          className="min-h-10 w-full min-w-0 rounded-md border border-input bg-background p-2 text-body-sm focus-ring-input"
          onChange={event => { if (event.target.value) controller.select({ ...change, targetVersion: event.target.value }) }}>
          <option value="">{t("chooseVersion")}</option>
          <optgroup label={t("tags")}>{Object.entries(options.tags).map(([tag, version]) => <option key={tag} value={tag} disabled={version === pkg.version}>{tag} → {version === pkg.version ? t("currentVersion", { version }) : version}</option>)}</optgroup>
          <optgroup label={t("versions")}>{options.versions.map(version => <option key={version} value={version} disabled={version === pkg.version}>{version === pkg.version ? t("currentVersion", { version }) : version}</option>)}</optgroup>
        </select>
      </div> : null}
      <Label htmlFor={`${id}-target`}>{t("targetVersion")}</Label>
      <Input id={`${id}-target`} value={selection.targetVersion ?? ""} autoComplete="off" spellCheck={false}
        disabled={blocked} maxLength={256} className="min-w-0 font-mono" aria-describedby={`${id}-hint`}
        onChange={event => controller.select({ ...change, targetVersion: event.target.value })} />
      <p id={`${id}-hint`} className="text-body-sm text-muted-foreground">{t("versionHint")}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="secondary" disabled={blocked} className="h-auto min-h-10 max-w-full border-border whitespace-normal"
          aria-busy={loadingVersions} onClick={() => { void controller.loadVersions({ manager, package: pkg.name }) }}><GlobalActionLabel pending={loadingVersions} icon={DownloadIcon}>{t(loadingVersions ? "loadingVersions" : "loadVersions")}</GlobalActionLabel></Button>
        <Button type="button" variant="secondary" disabled={blocked || !selection.targetVersion?.trim()}
          aria-busy={previewingChange} className="h-auto min-h-10 max-w-full border-border whitespace-normal" onClick={event => onPreview(change, event.currentTarget)}><GlobalActionLabel pending={previewingChange} icon={EyeIcon}>{t(previewingChange ? "loadingPreview" : "preview")}</GlobalActionLabel></Button>
      </div>
    </div> : null}
  </div>
}
