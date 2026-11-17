"use client"

import { useEffect, useRef } from "react"
import { useRunnerDock } from "@/components/features/npm-runner/npm-runner-provider"
import type { RunJob, RunnerContext } from "@/lib/api/types"

export function useNpmRunner(context: RunnerContext | null, requestPath: string, onMutated: (job: RunJob) => void) {
  const dock = useRunnerDock()
  const onMutatedRef = useRef(onMutated)
  useEffect(() => { onMutatedRef.current = onMutated }, [onMutated])

  useEffect(() => {
    return dock.registerMutationListener(job => onMutatedRef.current(job))
  }, [dock])

  useEffect(() => {
    dock.syncProjectContext(context, requestPath)
  }, [context, dock, requestPath])

  return {
    requestPath,
    state: dock.state,
    start: dock.start,
    cancel: dock.cancel,
    clearRecovery: dock.clearRecovery,
    retryPoll: dock.retryPoll,
    refresh: dock.refresh,
    follow: dock.follow,
  }
}
