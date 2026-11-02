"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { cancelBrowserProjectAnalysis, pollBrowserProjectAnalysis, startBrowserProjectAnalysis } from "@/lib/api/projects-browser"
import type { ProjectDetail } from "@/lib/api/types"
import { initialAnalysisState } from "@/lib/projects/project-analysis-policy"
import type { AnalysisConflict } from "@/lib/projects/project-analysis-policy"
import { createProjectAnalysisSession } from "@/lib/projects/project-analysis-session"
import type { ProjectAnalysisSession } from "@/lib/projects/project-analysis-session"

export function useProjectAnalysis(detail: ProjectDetail) {
  const [state, setState] = useState(() => initialAnalysisState(detail))
  const session = useRef<ProjectAnalysisSession | null>(null)

  useEffect(() => {
    const current = createProjectAnalysisSession({
      api: { start: startBrowserProjectAnalysis, get: pollBrowserProjectAnalysis, cancel: cancelBrowserProjectAnalysis },
      clock: { setTimeout: (callback, delay) => window.setTimeout(callback, delay), clearTimeout: id => window.clearTimeout(id) },
      visibility: {
        isVisible: () => document.visibilityState === "visible",
        subscribe(callback) {
          document.addEventListener("visibilitychange", callback)
          return () => document.removeEventListener("visibilitychange", callback)
        },
      },
      onChange: setState,
    })
    session.current = current
    return () => { current.dispose(); session.current = null }
  }, [])

  useEffect(() => { session.current?.refresh(detail) }, [detail])

  const start = useCallback((path: string) => session.current?.start(path) ?? Promise.resolve(), [])
  const cancel = useCallback(() => session.current?.cancel() ?? Promise.resolve(), [])
  const retryPoll = useCallback(() => session.current?.retryPoll(), [])
  const follow = useCallback((conflict: AnalysisConflict) => session.current?.follow(conflict), [])
  const refresh = useCallback((next: ProjectDetail) => session.current?.refresh(next), [])

  return { state, start, cancel, retryPoll, follow, refresh }
}
