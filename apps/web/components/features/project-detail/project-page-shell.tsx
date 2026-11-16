"use client"

import { useRouter } from "next/navigation"
import { useCallback, useState, useTransition } from "react"
import { useTranslations } from "next-intl"

import { DiskUsagePanel } from "@/components/features/disk-usage/disk-usage-panel"
import { FilesPanel } from "@/components/features/file-ops/files-panel"
import { NpmRunnerPanel } from "@/components/features/npm-runner/npm-runner-panel"
import { ProjectDetailPanel } from "@/components/features/project-detail/project-detail-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useNavigationContinuity, useViewState } from "@/hooks/use-navigation-continuity"
import { useNpmRunner } from "@/hooks/use-npm-runner"
import type { DiskUsageActiveJob, ProjectDetail, RunnerContext, ScannedProject } from "@/lib/api/types"
import { runnerDisplay } from "@/lib/npm-runner/runner-display"
import {
  PROJECT_DETAIL_TABS,
  makeViewStateKey,
  projectDetailTabCodec,
  type ProjectDetailTab,
} from "@/lib/ui/navigation-targets"

export function ProjectPageShell({
  path,
  detail,
  detailError,
  context,
  contextError,
  scannedProject,
  activeDiskJob,
}: {
  path: string
  detail: ProjectDetail | null
  detailError: string | null
  context: RunnerContext | null
  contextError: string | null
  scannedProject: ScannedProject | null
  activeDiskJob: DiskUsageActiveJob | null
}) {
  const t = useTranslations("projectDetail")
  const router = useRouter()
  const [, startTransition] = useTransition()
  const { flushScroll } = useNavigationContinuity()
  const [activeTab, setActiveTab] = useViewState<ProjectDetailTab>(
    makeViewStateKey("project-detail-tab", path),
    projectDetailTabCodec,
    "overview",
  )
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<ProjectDetailTab>>(() => new Set(["overview"]))
  const onMutated = useCallback(() => { startTransition(() => router.refresh()) }, [router])
  const controller = useNpmRunner(context, path, onMutated)
  const runner = <NpmRunnerPanel controller={controller} contextError={contextError} />
  const { busy } = runnerDisplay(controller.state, { action: "install_all" }, contextError)

  const diskInitialPath = scannedProject?.nodeModules.exists ? scannedProject.nodeModules.path : path
  const diskInitialView = scannedProject?.nodeModules.exists ? "packages" : "directory"

  function handleTabChange(value: string) {
    const next = PROJECT_DETAIL_TABS.find((tab) => tab === value)
    if (!next || next === activeTab) return
    flushScroll()
    setVisitedTabs((prev) => {
      const updated = new Set(prev)
      updated.add(activeTab)
      updated.add(next)
      return updated
    })
    setActiveTab(next)
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="min-w-0 gap-6">
      <TabsList aria-label={t("tabs.label")} className="max-w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview" className="flex-none px-4">{t("tabs.overview")}</TabsTrigger>
        <TabsTrigger value="files" className="flex-none px-4">{t("tabs.files")}</TabsTrigger>
        <TabsTrigger value="disk" className="flex-none px-4">{t("tabs.diskUsage")}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" forceMount className="min-w-0 data-[state=inactive]:hidden">
        {activeTab === "overview" || visitedTabs.has("overview") ? (
          <ProjectDetailPanel
            detail={detail}
            detailError={detailError}
            runnerBusy={busy}
            runner={runner}
            active={activeTab === "overview"}
          />
        ) : null}
      </TabsContent>
      <TabsContent value="files" forceMount className="min-w-0 data-[state=inactive]:hidden">
        {activeTab === "files" || visitedTabs.has("files") ? (
          scannedProject ? (
            <FilesPanel project={scannedProject} embedded active={activeTab === "files"} />
          ) : (
            <div className="min-w-0 space-y-2 rounded-md border border-border bg-card p-4 text-body-sm text-card-foreground md:p-6">
              <h2 className="text-heading-md">{t("tabs.filesUnavailableTitle")}</h2>
              <p className="text-muted-foreground">{t("tabs.filesUnavailable")}</p>
            </div>
          )
        ) : null}
      </TabsContent>
      <TabsContent value="disk" forceMount className="min-w-0 data-[state=inactive]:hidden">
        {activeTab === "disk" || visitedTabs.has("disk") ? (
          <DiskUsagePanel
            initialPath={diskInitialPath}
            initialView={diskInitialView}
            hasExplicitPath
            hasExplicitView
            activeJob={activeDiskJob}
            embedded
            active={activeTab === "disk"}
          />
        ) : null}
      </TabsContent>
    </Tabs>
  )
}
