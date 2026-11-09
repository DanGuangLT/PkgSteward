"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"

import {
  cancelBrowserPmJob, executeBrowserPmPin, getBrowserLatestPmJob, getBrowserPmContext,
  pollBrowserPmJob, startBrowserPmPreview, startBrowserPmVersions,
} from "@/lib/api/package-managers/package-managers-browser"
import type { PmSelection } from "@/lib/package-managers/pm-preview-form"
import { createPmSession, initialPmState } from "@/lib/package-managers/pm-session"
import type { PmSession } from "@/lib/package-managers/pm-session"
import type { PmManager } from "@/lib/package-managers/pm-types"

// Thin React binding: all state rules live in the framework-free session.
export function usePackageManagers(path: string) {
  const router = useRouter()
  const [, startRefresh] = useTransition()
  const [state, setState] = useState(initialPmState)
  const session = useRef<PmSession | null>(null)

  useEffect(() => {
    const current: PmSession = createPmSession({
      path,
      api: {
        context: getBrowserPmContext, versions: startBrowserPmVersions, preview: startBrowserPmPreview,
        execute: executeBrowserPmPin, latest: getBrowserLatestPmJob, get: pollBrowserPmJob, cancel: cancelBrowserPmJob,
      },
      clock: {
        now: () => Date.now(),
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
      // The manifest may have changed: re-read this panel and the server-rendered project detail once.
      onMutated: () => { void current.loadContext(); startRefresh(() => router.refresh()) },
    })
    session.current = current
    void current.refresh()
    return () => { current.dispose(); session.current = null }
  }, [path, router])

  const refresh = useCallback(() => session.current?.refresh() ?? Promise.resolve(), [])
  const loadVersions = useCallback((manager: PmManager) => session.current?.loadVersions(manager) ?? Promise.resolve(), [])
  const preview = useCallback((selection: PmSelection) => session.current?.preview(selection) ?? Promise.resolve(), [])
  const stopPreview = useCallback(() => session.current?.stopPreview() ?? false, [])
  const execute = useCallback(() => session.current?.execute() ?? Promise.resolve(), [])
  const select = useCallback((selection: PmSelection) => session.current?.select(selection), [])
  const dismissPreview = useCallback(() => session.current?.dismissPreview(), [])
  const acknowledge = useCallback((code: string, checked: boolean) => session.current?.acknowledge(code, checked), [])
  const cancel = useCallback(() => session.current?.cancel() ?? Promise.resolve(), [])
  const retryPoll = useCallback(() => session.current?.retryPoll(), [])

  return { state, refresh, loadVersions, preview, stopPreview, execute, select, dismissPreview, acknowledge, cancel, retryPoll }
}

export type PackageManagersController = ReturnType<typeof usePackageManagers>
