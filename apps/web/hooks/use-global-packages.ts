"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  getBrowserGlobalSnapshot, startBrowserGlobalInventory, startBrowserGlobalVersions,
  startBrowserGlobalPreview, executeBrowserGlobalPackage, getBrowserLatestGlobalJob,
  pollBrowserGlobalJob, getBrowserGlobalLogs, cancelBrowserGlobalJob,
} from "@/lib/api/global-packages-browser"
import { createGlobalSession, initialGlobalState } from "@/lib/global-packages/global-session"
import type { GlobalSession, GlobalState } from "@/lib/global-packages/global-session"
import type { GlobalJob, GlobalSnapshot, GlobalVersionsRequest } from "@/lib/global-packages/global-types"
import type { GlobalConsent, GlobalSelection } from "@/lib/global-packages/global-preview-form"

export function useGlobalPackages(snapshot: GlobalSnapshot | null, latest: GlobalJob | null, onMutated: (job: GlobalJob) => void) {
  const [state, setState] = useState<GlobalState>(() => initialGlobalState(snapshot))
  const session = useRef<GlobalSession | null>(null)
  const onMutatedRef = useRef(onMutated)
  useEffect(() => { onMutatedRef.current = onMutated }, [onMutated])

  useEffect(() => {
    const current = createGlobalSession({
      api: {
        snapshot: getBrowserGlobalSnapshot, inventory: startBrowserGlobalInventory, versions: startBrowserGlobalVersions,
        preview: startBrowserGlobalPreview, execute: executeBrowserGlobalPackage, latest: getBrowserLatestGlobalJob,
        get: pollBrowserGlobalJob, logs: getBrowserGlobalLogs, cancel: cancelBrowserGlobalJob,
      },
      clock: { now: () => Date.now(), setTimeout: (callback, delay) => window.setTimeout(callback, delay), clearTimeout: id => window.clearTimeout(id) },
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
  useEffect(() => { void session.current?.refresh(snapshot, latest) }, [snapshot, latest])

  const inventory = useCallback(() => session.current?.inventory() ?? Promise.resolve(), [])
  const loadVersions = useCallback((input: Pick<GlobalVersionsRequest, "manager" | "package">) => session.current?.loadVersions(input) ?? Promise.resolve(), [])
  const preview = useCallback((selection: GlobalSelection) => session.current?.preview(selection) ?? Promise.resolve(), [])
  const stopPreview = useCallback(() => session.current?.stopPreview() ?? false, [])
  const execute = useCallback(() => session.current?.execute() ?? Promise.resolve(), [])
  const select = useCallback((selection: GlobalSelection) => session.current?.select(selection), [])
  const consent = useCallback((input: Partial<GlobalConsent>) => session.current?.consent(input), [])
  const cancel = useCallback(() => session.current?.cancel() ?? Promise.resolve(), [])
  const retryPoll = useCallback(() => session.current?.retryPoll(), [])
  const refresh = useCallback(() => session.current?.refresh() ?? Promise.resolve(), [])
  return { state, inventory, loadVersions, preview, stopPreview, execute, select, consent, cancel, retryPoll, refresh }
}
