"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { getBrowserFileTree } from "@/lib/api/file-ops/file-ops-browser"
import { ApiError } from "@/lib/api/response"
import type { FileTreeEntry } from "@/lib/api/types"
import { getDefaultNavigationStore } from "@/lib/ui/navigation-store"
import { makeViewStateKey } from "@/lib/ui/navigation-targets"

const MAX_EXPANDED_PATHS = 256

function readInitialExpanded(root: string): string[] {
  const store = getDefaultNavigationStore()
  if (!store.isHydrated()) return []
  const record = store.getEphemeral<string[]>(makeViewStateKey("file-tree-expanded", root))
  if (!record || record.invalid || !Array.isArray(record.value)) return []
  return record.value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry !== root)
    .slice(0, MAX_EXPANDED_PATHS)
}

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
  const [initialExpanded] = useState<string[]>(() => readInitialExpanded(root))
  const [levels, setLevels] = useState<ReadonlyMap<string, TreeLevel>>(() => {
    const map = new Map<string, TreeLevel>([[root, { status: "loading" }]])
    for (const path of initialExpanded) map.set(path, { status: "loading" })
    return map
  })
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialExpanded))
  const requests = useRef(new Set<AbortController>())
  const ephemeralKey = makeViewStateKey("file-tree-expanded", root)

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
    for (const path of initialExpanded) load(path)
    return stopRequests
  }, [initialExpanded, load, root, stopRequests])

  useEffect(() => {
    const store = getDefaultNavigationStore()
    if (!store.isHydrated()) return
    if (expanded.size === 0) store.clearEphemeral(ephemeralKey)
    else store.setEphemeral(ephemeralKey, [...expanded].slice(0, MAX_EXPANDED_PATHS))
  }, [ephemeralKey, expanded])

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
    getDefaultNavigationStore().clearEphemeral(ephemeralKey)
    setExpanded(new Set())
    setLevels(new Map([[root, { status: "loading" }]]))
    load(root)
  }, [ephemeralKey, load, root, stopRequests])

  return { levels, expanded, childrenOf, toggleExpanded, retry, reload }
}
