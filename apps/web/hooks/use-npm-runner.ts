"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cancelBrowserNpmRun, getBrowserLatestNpmRun, getBrowserNpmRunLogs, getBrowserRunnerContext, pollBrowserNpmRun, startBrowserNpmRun } from "@/lib/api/npm-runs-browser"
import type { RunJob, RunnerContext } from "@/lib/api/types"
import { initialRunnerState } from "@/lib/npm-runner/runner-policy"
import type { RunnerSelection, RunnerState } from "@/lib/npm-runner/runner-policy"
import { createRunnerSession } from "@/lib/npm-runner/runner-session"
import type { RunnerSession } from "@/lib/npm-runner/runner-session"

export function useNpmRunner(context: RunnerContext | null, requestPath: string, onMutated: (job: RunJob) => void) {
  const [state, setState] = useState<RunnerState>(() => ({ ...initialRunnerState(context), requestPath }))
  const session = useRef<RunnerSession | null>(null)
  const onMutatedRef = useRef(onMutated)
  useEffect(() => { onMutatedRef.current = onMutated }, [onMutated])

  useEffect(() => {
    const current = createRunnerSession({
      api: { context: getBrowserRunnerContext, start: startBrowserNpmRun, latest: getBrowserLatestNpmRun,
        get: pollBrowserNpmRun, logs: getBrowserNpmRunLogs, cancel: cancelBrowserNpmRun },
      clock: { setTimeout: (callback, delay) => window.setTimeout(callback, delay), clearTimeout: id => window.clearTimeout(id) },
      visibility: {
        isVisible: () => document.visibilityState === "visible",
        subscribe(callback) {
          document.addEventListener("visibilitychange", callback)
          return () => document.removeEventListener("visibilitychange", callback)
        },
      },
      onChange: setState, onMutated: job => onMutatedRef.current(job),
    })
    session.current = current
    return () => { current.dispose(); session.current = null }
  }, [])
  useEffect(() => { void session.current?.refresh(context, requestPath) }, [context, requestPath])

  const start = useCallback((selection: RunnerSelection) => session.current?.start(selection) ?? Promise.resolve(), [])
  const cancel = useCallback(() => session.current?.cancel() ?? Promise.resolve(), [])
  const retryPoll = useCallback(() => session.current?.retryPoll(), [])
  const refresh = useCallback(() => session.current?.refresh() ?? Promise.resolve(), [])
  const follow = useCallback(() => session.current?.follow() ?? null, [])
  return { state, start, cancel, retryPoll, refresh, follow }
}
