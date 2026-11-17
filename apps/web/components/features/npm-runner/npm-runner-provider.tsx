"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  cancelBrowserNpmRun,
  clearBrowserRecoveryHold,
  getBrowserLatestNpmRun,
  getBrowserNpmRunLogs,
  getBrowserRunnerContext,
  pollBrowserNpmRun,
  startBrowserNpmRun,
} from "@/lib/api/npm-runs/npm-runs-browser"
import type { RunJob, RunnerContext } from "@/lib/api/types"
import { initialRunnerState, type RunnerSelection, type RunnerState } from "@/lib/npm-runner/runner-policy"
import { createRunnerSession, type RunnerSession } from "@/lib/npm-runner/runner-session"
import { invalidateNavigationSnapshots } from "@/lib/ui/navigation-store"

export interface NpmRunnerContextValue {
  state: RunnerState
  start: (selection: RunnerSelection) => Promise<void>
  cancel: () => Promise<void>
  clearRecovery: () => Promise<void>
  retryPoll: () => void
  refresh: () => Promise<void>
  follow: () => string | null
  dismissCompletedJob: () => void
  syncProjectContext: (context: RunnerContext | null, requestPath: string | null) => void
  registerMutationListener: (listener: (job: RunJob) => void) => () => void
}

const NpmRunnerContext = createContext<NpmRunnerContextValue | null>(null)

export function NpmRunnerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RunnerState>(() => initialRunnerState())
  const session = useRef<RunnerSession | null>(null)
  const mutationListeners = useRef(new Set<(job: RunJob) => void>())

  useEffect(() => {
    const current = createRunnerSession({
      api: {
        context: getBrowserRunnerContext,
        start: startBrowserNpmRun,
        latest: getBrowserLatestNpmRun,
        clearRecovery: clearBrowserRecoveryHold,
        get: pollBrowserNpmRun,
        logs: getBrowserNpmRunLogs,
        cancel: cancelBrowserNpmRun,
      },
      clock: {
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: id => window.clearTimeout(id),
      },
      visibility: {
        isVisible: () => document.visibilityState === "visible",
        subscribe(callback) {
          document.addEventListener("visibilitychange", callback)
          return () => document.removeEventListener("visibilitychange", callback)
        },
      },
      onChange: setState,
      onMutated: job => {
        invalidateNavigationSnapshots("runner")
        for (const listener of mutationListeners.current) listener(job)
      },
    })
    session.current = current
    setState(current.getSnapshot())
    current.syncProjectContext(null, null)
    return () => {
      current.dispose()
      session.current = null
    }
  }, [])

  const start = useCallback((selection: RunnerSelection) => session.current?.start(selection) ?? Promise.resolve(), [])
  const cancel = useCallback(() => session.current?.cancel() ?? Promise.resolve(), [])
  const clearRecovery = useCallback(() => session.current?.clearRecovery() ?? Promise.resolve(), [])
  const retryPoll = useCallback(() => { session.current?.retryPoll() }, [])
  const refresh = useCallback(() => session.current?.refresh() ?? Promise.resolve(), [])
  const follow = useCallback(() => session.current?.follow() ?? null, [])
  const dismissCompletedJob = useCallback(() => { session.current?.dismissCompletedJob() }, [])
  const syncProjectContext = useCallback((context: RunnerContext | null, requestPath: string | null) => {
    session.current?.syncProjectContext(context, requestPath)
  }, [])
  const registerMutationListener = useCallback((listener: (job: RunJob) => void) => {
    mutationListeners.current.add(listener)
    return () => { mutationListeners.current.delete(listener) }
  }, [])

  const value = useMemo<NpmRunnerContextValue>(() => ({
    state,
    start,
    cancel,
    clearRecovery,
    retryPoll,
    refresh,
    follow,
    dismissCompletedJob,
    syncProjectContext,
    registerMutationListener,
  }), [
    state,
    start,
    cancel,
    clearRecovery,
    retryPoll,
    refresh,
    follow,
    dismissCompletedJob,
    syncProjectContext,
    registerMutationListener,
  ])

  return <NpmRunnerContext.Provider value={value}>{children}</NpmRunnerContext.Provider>
}

export function useRunnerDock(): NpmRunnerContextValue {
  const ctx = useContext(NpmRunnerContext)
  if (!ctx) throw new Error("useRunnerDock must be used within NpmRunnerProvider")
  return ctx
}
