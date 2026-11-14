"use client"

import { useRouter } from "next/navigation"
import { useCallback, useTransition } from "react"

import { NpmRunnerPanel } from "@/components/features/npm-runner/npm-runner-panel"
import { ProjectDetailPanel } from "@/components/features/project-detail/project-detail-panel"
import { useNpmRunner } from "@/hooks/use-npm-runner"
import type { ProjectDetail, RunnerContext } from "@/lib/api/types"
import { runnerDisplay } from "@/lib/npm-runner/runner-display"

export function ProjectPageShell({ path, detail, detailError, context, contextError }: {
  path: string
  detail: ProjectDetail | null
  detailError: string | null
  context: RunnerContext | null
  contextError: string | null
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const onMutated = useCallback(() => { startTransition(() => router.refresh()) }, [router])
  const controller = useNpmRunner(context, path, onMutated)
  const runner = <NpmRunnerPanel controller={controller} contextError={contextError} />
  const { busy } = runnerDisplay(controller.state, { action: "install_all" }, contextError)
  return <ProjectDetailPanel detail={detail} detailError={detailError} runnerBusy={busy} runner={runner} />
}
