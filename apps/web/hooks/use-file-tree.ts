"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getBrowserFileTree } from "@/lib/api/file-ops-browser"
import { ApiError } from "@/lib/api/response"
import type { FileTreeEntry } from "@/lib/api/types"

export type TreeLevel =
  | { status: "loading" }
  | { status: "ready"; entries: FileTreeEntry[]; truncated: boolean }
  | { status: "failed"; code: string }

export interface FileTreeController {
  levels: ReadonlyMap<string, TreeLevel>
  expanded: ReadonlySet<string>
  childrenOf(path: string): readonly FileTreeEntry[] | undefined
  toggleExpanded(path: string): void
  retry(path: string): void
  reload(): void
}

async function readLevel(path: string, signal: AbortSignal): Promise<TreeLevel> {
  try {
    const { entries, truncated } = await getBrowserFileTree(path, signal)
    return { status: "ready", entries, truncated }
  } catch (cause) {
    return { status: "failed", code: cause instanceof ApiError ? cause.code ?? "UNKNOWN" : "UNKNOWN" }
  }
}

/** Tải lười từng tầng: mở folder mới gọi API, không bao giờ duyệt cả cây một lúc. */
export function useFileTree(root: string): FileTreeController {
  const [levels, setLevels] = useState<ReadonlyMap<string, TreeLevel>>(() => new Map([[root, { status: "loading" }]]))
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const requests = useRef(new Set<AbortController>())

  const setLevel = useCallback((path: string, level: TreeLevel) => {
    setLevels((previous) => new Map(previous).set(path, level))
  }, [])

  const load = useCallback((path: string) => {
    const controller = new AbortController()
    requests.current.add(controller)
    void readLevel(path, controller.signal).then((level) => {
      requests.current.delete(controller)
      if (!controller.signal.aborted) setLevel(path, level)
    })
  }, [setLevel])

  const stopRequests = useCallback(() => {
    for (const controller of requests.current) controller.abort()
    requests.current.clear()
  }, [])

  useEffect(() => {
    load(root)
    return stopRequests
  }, [load, root, stopRequests])

  const childrenOf = useCallback((path: string) => {
    const level = levels.get(path)
    return level?.status === "ready" ? level.entries : undefined
  }, [levels])

  const toggleExpanded = useCallback((path: string) => {
    const opening = !expanded.has(path)
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
    if (opening && !levels.has(path)) {
      setLevel(path, { status: "loading" })
      load(path)
    }
  }, [expanded, levels, load, setLevel])

  const retry = useCallback((path: string) => {
    setLevel(path, { status: "loading" })
    load(path)
  }, [load, setLevel])

  const reload = useCallback(() => {
    stopRequests()
    setExpanded(new Set())
    setLevels(new Map([[root, { status: "loading" }]]))
    load(root)
  }, [load, root, stopRequests])

  return { levels, expanded, childrenOf, toggleExpanded, retry, reload }
}
