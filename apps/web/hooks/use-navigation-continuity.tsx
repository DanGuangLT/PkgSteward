"use client"

import { usePathname, useSearchParams } from "next/navigation"
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import {
  getDefaultNavigationStore,
  type MemorySnapshotRecord,
  type MutationReason,
  type NavigationStore,
  type ScrollPosition,
} from "@/lib/ui/navigation-store"
import {
  validateOriginEntryId,
  validateReturnTarget,
  type ViewStateCodec,
} from "@/lib/ui/navigation-targets"

const HISTORY_ENTRY_FIELD = "pkgStewardNavEntryId"
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "])

let fallbackSequence = 0

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function createEntryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  fallbackSequence += 1
  return `nav-${Date.now().toString(36)}-${fallbackSequence}`
}

function readHistoryEntryId(): string | null {
  if (typeof window === "undefined" || !isRecord(window.history.state)) return null
  return validateOriginEntryId(window.history.state[HISTORY_ENTRY_FIELD])
}

function stripNextInternalHistoryKeys(state: unknown): Record<string, unknown> {
  if (!isRecord(state)) return {}
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (key === "__NA" || key === "_N" || key === "__PRIVATE_NEXTJS_INTERNALS_TREE") continue
    copy[key] = value
  }
  return copy
}

function stampHistoryEntryId(entryId: string): void {
  if (typeof window === "undefined") return
  const current = window.history.state
  if (isRecord(current) && current.__NA) {
    // Next's replaceState wrapper skips router.restore when __NA is already present.
    window.history.replaceState(
      { ...current, [HISTORY_ENTRY_FIELD]: entryId },
      "",
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    )
    return
  }
  const custom = stripNextInternalHistoryKeys(current)
  custom[HISTORY_ENTRY_FIELD] = entryId
  window.history.replaceState(custom, "")
}

export function replaceHistoryUrlPreservingState(nextUrl: string): void {
  if (typeof window === "undefined") return
  const safeUrl = validateReturnTarget(nextUrl)
  if (safeUrl === null) return
  const currentFull = `${window.location.pathname}${window.location.search}`
  if (currentFull === safeUrl) return

  const custom = stripNextInternalHistoryKeys(window.history.state)
  const existingId = readHistoryEntryId()
  if (existingId) custom[HISTORY_ENTRY_FIELD] = existingId
  // Omitting Next's internal keys lets Next's patched replaceState copy __NA/__PRIVATE_NEXTJS_INTERNALS_TREE
  // and sync useSearchParams/usePathname without triggering an RSC server round-trip.
  window.history.replaceState(custom, "", safeUrl)
}

export interface NavigationContinuityApi {
  hydrated: boolean
  entryId: string | null
  currentUrl: string
  mutationEpoch: number
  bumpMutationEpoch: (reason?: MutationReason) => number
  getMemorySnapshot: <T>(key: string) => MemorySnapshotRecord<T> | null
  setMemorySnapshot: <T>(key: string, value: T) => void
  clearMemorySnapshot: (key?: string) => void
  scheduleReturnScroll: (targetHref: string, originId: string) => void
  flushScroll: () => void
}

const NavigationStoreContext = createContext<NavigationStore | null>(null)
const serverBoolFalse = () => false
const serverNull = () => null
const serverDefaultUrl = () => "/"
const serverZero = () => 0

function useNavigationStore(): NavigationStore {
  return useContext(NavigationStoreContext) ?? getDefaultNavigationStore()
}

function NavigationRuntimeSync({ store }: { store: NavigationStore }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchString = searchParams.toString()

  useEffect(() => {
    store.hydrate()
    const currentUrl = searchString ? `${pathname}?${searchString}` : pathname
    let entryId = readHistoryEntryId()
    if (entryId === null) {
      entryId = createEntryId()
      stampHistoryEntryId(entryId)
    }
    store.setActiveNavigation(entryId, currentUrl)

    let rafId: number | null = null
    const saveScroll = () => {
      if (entryId === null) return
      const routeKey = store.getActiveRouteKey() ?? `${pathname}::`
      store.setScroll(entryId, routeKey, { x: window.scrollX, y: window.scrollY })
    }

    const onScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        saveScroll()
      })
    }

    const onPopState = () => {
      const nextId = readHistoryEntryId() ?? createEntryId()
      const nextUrl = `${window.location.pathname}${window.location.search}`
      store.setActiveNavigation(nextId, nextUrl)
    }

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (target) saveScroll()
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("popstate", onPopState)
    document.addEventListener("click", onDocumentClick, { capture: true })
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("popstate", onPopState)
      document.removeEventListener("click", onDocumentClick, { capture: true })
    }
  }, [pathname, searchString, store])

  return null
}

export function NavigationContinuityProvider({ children }: { children: ReactNode }) {
  const [store] = useState<NavigationStore>(() => getDefaultNavigationStore())

  return (
    <NavigationStoreContext.Provider value={store}>
      <Suspense fallback={null}>
        <NavigationRuntimeSync store={store} />
      </Suspense>
      {children}
    </NavigationStoreContext.Provider>
  )
}

export function useNavigationContinuity(): NavigationContinuityApi {
  const store = useNavigationStore()
  const hydrated = useSyncExternalStore(store.subscribe, store.isHydrated, serverBoolFalse)
  const entryId = useSyncExternalStore(store.subscribe, store.getActiveEntryId, serverNull)
  const currentUrl = useSyncExternalStore(store.subscribe, store.getCurrentUrl, serverDefaultUrl)
  const mutationEpoch = useSyncExternalStore(store.subscribe, store.getMutationEpoch, serverZero)

  const bumpMutationEpoch = useCallback(
    (reason: MutationReason = "manual") => store.bumpMutationEpoch(reason),
    [store],
  )
  const getMemorySnapshot = useCallback(
    <T,>(key: string) => store.getSnapshotRecord<T>(key),
    [store],
  )
  const setMemorySnapshot = useCallback(
    <T,>(key: string, value: T) => store.setSnapshot(key, value),
    [store],
  )
  const clearMemorySnapshot = useCallback(
    (key?: string) => store.clearSnapshot(key),
    [store],
  )
  const scheduleReturnScroll = useCallback(
    (targetHref: string, originId: string) => {
      const safeHref = validateReturnTarget(targetHref)
      const safeOrigin = validateOriginEntryId(originId)
      if (safeHref && safeOrigin) store.setPendingReturnScroll(safeHref, safeOrigin)
    },
    [store],
  )
  const flushScroll = useCallback(() => {
    const activeId = store.getActiveEntryId()
    const routeKey = store.getActiveRouteKey()
    if (!activeId || !routeKey || typeof window === "undefined") return
    store.setScroll(activeId, routeKey, { x: window.scrollX, y: window.scrollY })
  }, [store])

  return {
    hydrated,
    entryId,
    currentUrl,
    mutationEpoch,
    bumpMutationEpoch,
    getMemorySnapshot,
    setMemorySnapshot,
    clearMemorySnapshot,
    scheduleReturnScroll,
    flushScroll,
  }
}

export function useViewState<T>(
  key: string,
  codec: ViewStateCodec<T>,
  initial: T | (() => T),
): readonly [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const store = useNavigationStore()

  const readClient = useCallback(
    () => (store.isHydrated() ? store.readViewState(key, codec) : null),
    [codec, key, store],
  )
  const stored = useSyncExternalStore(store.subscribe, readClient, serverNull)

  const value = stored ?? (typeof initial === "function" ? (initial as () => T)() : initial)

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const current =
        (store.isHydrated() ? store.readViewState(key, codec) : null)
        ?? (typeof initial === "function" ? (initial as () => T)() : initial)
      const resolved = typeof next === "function" ? (next as (prev: T) => T)(current) : next
      store.writeViewState(key, codec, resolved)
    },
    [codec, initial, key, store],
  )

  const reset = useCallback(() => {
    store.clearViewState(key)
  }, [key, store])

  return [value, setValue, reset] as const
}

export function useRouteScrollContinuity({
  routeKey,
  ready,
  active = true,
}: {
  routeKey: string
  ready: boolean
  active?: boolean
}): void {
  const store = useNavigationStore()
  const hydrated = useSyncExternalStore(store.subscribe, store.isHydrated, serverBoolFalse)
  const entryId = useSyncExternalStore(store.subscribe, store.getActiveEntryId, serverNull)
  const currentUrl = useSyncExternalStore(store.subscribe, store.getCurrentUrl, serverDefaultUrl)

  const restoredKeyRef = useRef<string | null>(null)
  const userScrolledRef = useRef(false)

  useEffect(() => {
    if (!active) return
    store.setActiveRouteKey(routeKey)
    return () => {
      if (store.getActiveRouteKey() === routeKey) {
        store.setActiveRouteKey(null)
      }
    }
  }, [active, routeKey, store])

  useEffect(() => {
    userScrolledRef.current = false
    if (!active) restoredKeyRef.current = null
  }, [active, entryId, routeKey])

  useEffect(() => {
    if (!active || typeof window === "undefined") return
    const cancelDeferred = () => {
      userScrolledRef.current = true
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) userScrolledRef.current = true
    }
    window.addEventListener("wheel", cancelDeferred, { passive: true })
    window.addEventListener("touchmove", cancelDeferred, { passive: true })
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("wheel", cancelDeferred)
      window.removeEventListener("touchmove", cancelDeferred)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [active, entryId, routeKey])

  useEffect(() => {
    if (!active || !hydrated || !ready || entryId === null || typeof window === "undefined") return
    const liveUrl = window.location.search
      ? `${window.location.pathname}${window.location.search}`
      : window.location.pathname
    if (currentUrl !== liveUrl) return

    const visitKey = `${entryId}@@${routeKey}`
    if (restoredKeyRef.current === visitKey) return
    restoredKeyRef.current = visitKey

    if (userScrolledRef.current) return

    const originId = store.consumePendingReturnScroll(currentUrl)
    const targetPos: ScrollPosition | null = originId
      ? store.getScroll(originId, routeKey)
      : store.getScroll(entryId, routeKey)

    if (!targetPos) return
    if (originId) store.setScroll(entryId, routeKey, targetPos)
    if (targetPos.x === 0 && targetPos.y === 0) return

    let cancelled = false
    let rafId = 0
    let attempts = 0

    const applyScroll = () => {
      if (cancelled || userScrolledRef.current) return
      window.scrollTo({ left: targetPos.x, top: targetPos.y, behavior: "auto" })
      const maxReachableY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      attempts += 1
      if (maxReachableY + 4 < targetPos.y && attempts < 6) {
        rafId = window.requestAnimationFrame(applyScroll)
      }
    }

    rafId = window.requestAnimationFrame(applyScroll)
    return () => {
      cancelled = true
      if (rafId) window.cancelAnimationFrame(rafId)
    }
  }, [active, currentUrl, entryId, hydrated, ready, routeKey, store])
}

export function useNavigationEphemeral<T>(key: string): {
  read: () => { value: T; invalid: boolean } | null
  write: (value: T) => void
  clear: () => void
} {
  const store = useNavigationStore()
  const read = useCallback(() => store.getEphemeral<T>(key), [key, store])
  const write = useCallback((value: T) => store.setEphemeral(key, value), [key, store])
  const clear = useCallback(() => store.clearEphemeral(key), [key, store])
  return { read, write, clear }
}
