import { MAX_QUERY_LENGTH, type ViewStateCodec } from "./navigation-targets.ts"

export const NAV_STORAGE_KEY = "pkgsteward.nav.v1"
export const NAV_STORAGE_VERSION = 1
export const NAV_MAX_ENTRIES = 128
export const NAV_MAX_BYTES = 128 * 1024
export const NAV_MAX_QUERY_LENGTH = MAX_QUERY_LENGTH
export const NAV_MAX_MEMORY_SNAPSHOTS = 32

export type MutationReason =
  | "scan"
  | "runner"
  | "package-manager"
  | "file-ops"
  | "global-packages"
  | "manual"

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ScrollPosition {
  x: number
  y: number
}

export interface MemorySnapshotRecord<T> {
  value: T
  epoch: number
  invalid: boolean
  storedAt: number
}

export interface NavigationStoreOptions {
  storage?: StorageLike | null
  now?: () => number
  maxEntries?: number
  maxBytes?: number
  maxMemorySnapshots?: number
}

interface StoredEntry {
  v: number
  t: number
  d: unknown
}

interface StoredScroll {
  x: number
  y: number
  t: number
}

interface StorageEnvelope {
  v: number
  entries: Record<string, StoredEntry>
  scrolls: Record<string, StoredScroll>
}

interface DecodedCacheEntry {
  version: number
  rawJson: string
  value: unknown
}

interface MemoryEntry {
  value: unknown
  epoch: number
  storedAt: number
}

const FORBIDDEN_PERSIST_KEYS = new Set([
  "previewId",
  "preview",
  "confirm",
  "confirmText",
  "acknowledgedRisks",
  "logs",
  "chunks",
  "stdin",
  "stdout",
  "stderr",
  "input",
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "operationId",
  "executeInput",
])

const utf8Encoder = new TextEncoder()

function utf8Bytes(text: string): number {
  return utf8Encoder.encode(text).byteLength
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function containsForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 16 || value === null || typeof value !== "object") return false
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenKey(item, depth + 1))
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PERSIST_KEYS.has(key) || containsForbiddenKey(nested, depth + 1)) {
      return true
    }
  }
  return false
}

function emptyEnvelope(): StorageEnvelope {
  return { v: NAV_STORAGE_VERSION, entries: {}, scrolls: {} }
}

function parseEnvelope(raw: string | null): StorageEnvelope {
  if (!raw) return emptyEnvelope()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainObject(parsed) || parsed.v !== NAV_STORAGE_VERSION) return emptyEnvelope()
    const entries: Record<string, StoredEntry> = {}
    if (isPlainObject(parsed.entries)) {
      for (const [key, item] of Object.entries(parsed.entries)) {
        if (
          isPlainObject(item)
          && typeof item.v === "number"
          && Number.isInteger(item.v)
          && typeof item.t === "number"
          && Number.isFinite(item.t)
          && "d" in item
          && !containsForbiddenKey(item.d)
        ) {
          entries[key] = { v: item.v, t: item.t, d: item.d }
        }
      }
    }
    const scrolls: Record<string, StoredScroll> = {}
    if (isPlainObject(parsed.scrolls)) {
      for (const [key, item] of Object.entries(parsed.scrolls)) {
        if (
          isPlainObject(item)
          && typeof item.x === "number"
          && Number.isFinite(item.x)
          && typeof item.y === "number"
          && Number.isFinite(item.y)
          && typeof item.t === "number"
          && Number.isFinite(item.t)
        ) {
          scrolls[key] = { x: Math.max(0, item.x), y: Math.max(0, item.y), t: item.t }
        }
      }
    }
    return { v: NAV_STORAGE_VERSION, entries, scrolls }
  } catch {
    return emptyEnvelope()
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null
  } catch {
    return null
  }
}

export function createNavigationStore(options: NavigationStoreOptions = {}) {
  const maxEntries = options.maxEntries ?? NAV_MAX_ENTRIES
  const maxBytes = options.maxBytes ?? NAV_MAX_BYTES
  const maxMemorySnapshots = options.maxMemorySnapshots ?? NAV_MAX_MEMORY_SNAPSHOTS
  const now = options.now ?? (() => Date.now())

  let envelope = emptyEnvelope()
  let hydrated = false
  let revision = 0
  let mutationEpoch = 0
  let activeEntryId: string | null = null
  let currentUrl = "/"
  let activeRouteKey: string | null = null
  const listeners = new Set<() => void>()
  const decodedCache = new Map<string, DecodedCacheEntry>()
  const memorySnapshots = new Map<string, MemoryEntry>()
  const ephemeralState = new Map<string, { value: unknown; epoch: number }>()
  let pendingReturnScroll: { targetHref: string; originId: string } | null = null

  function resolveStorage(): StorageLike | null {
    return options.storage === undefined ? browserStorage() : options.storage
  }

  function notify() {
    revision += 1
    for (const listener of listeners) listener()
  }

  function evictEnvelopeToBudget(protectedKey?: string) {
    const allItems = () => {
      const list: { kind: "entry" | "scroll"; key: string; t: number }[] = []
      for (const [key, value] of Object.entries(envelope.entries)) {
        list.push({ kind: "entry", key, t: value.t })
      }
      for (const [key, value] of Object.entries(envelope.scrolls)) {
        list.push({ kind: "scroll", key, t: value.t })
      }
      return list.sort((a, b) => a.t - b.t)
    }

    let items = allItems()
    while (items.length > maxEntries) {
      const victim = items.find((item) => item.key !== protectedKey) ?? items[0]
      if (!victim) break
      if (victim.kind === "entry") {
        delete envelope.entries[victim.key]
        decodedCache.delete(victim.key)
      } else {
        delete envelope.scrolls[victim.key]
      }
      items = allItems()
    }

    let serialized = JSON.stringify(envelope)
    while (utf8Bytes(serialized) > maxBytes) {
      const victim = items.find((item) => item.key !== protectedKey) ?? items[0]
      if (!victim) break
      if (victim.kind === "entry") {
        delete envelope.entries[victim.key]
        decodedCache.delete(victim.key)
      } else {
        delete envelope.scrolls[victim.key]
      }
      items = allItems()
      serialized = JSON.stringify(envelope)
    }
    return serialized
  }

  function persist(protectedKey?: string) {
    const serialized = evictEnvelopeToBudget(protectedKey)
    if (utf8Bytes(serialized) > maxBytes) return
    const storage = resolveStorage()
    if (!storage) return
    try {
      storage.setItem(NAV_STORAGE_KEY, serialized)
    } catch {
      // Blocked/quota-full storage keeps in-memory continuity active.
    }
  }

  function hydrate(): void {
    if (hydrated) return
    hydrated = true
    const storage = resolveStorage()
    if (!storage) return
    try {
      envelope = parseEnvelope(storage.getItem(NAV_STORAGE_KEY))
      evictEnvelopeToBudget()
    } catch {
      envelope = emptyEnvelope()
    }
    notify()
  }

  function readViewState<T>(key: string, codec: ViewStateCodec<T>): T | null {
    const entry = envelope.entries[key]
    if (!entry) return null

    if (entry.v !== codec.version || containsForbiddenKey(entry.d)) {
      delete envelope.entries[key]
      decodedCache.delete(key)
      persist()
      return null
    }

    let rawJson: string
    try {
      rawJson = JSON.stringify(entry.d)
    } catch {
      delete envelope.entries[key]
      decodedCache.delete(key)
      persist()
      return null
    }

    const cached = decodedCache.get(key)
    if (cached && cached.version === codec.version && cached.rawJson === rawJson) {
      return cached.value as T
    }

    let decoded: T | null
    try {
      decoded = codec.decode(entry.d)
    } catch {
      decoded = null
    }

    if (decoded === null) {
      delete envelope.entries[key]
      decodedCache.delete(key)
      persist()
      return null
    }

    decodedCache.set(key, { version: codec.version, rawJson, value: decoded })
    return decoded
  }

  function writeViewState<T>(key: string, codec: ViewStateCodec<T>, value: T): void {
    let encoded: unknown
    try {
      encoded = codec.encode(value)
    } catch {
      return
    }
    if (containsForbiddenKey(encoded)) return

    let decoded: T | null
    try {
      decoded = codec.decode(encoded)
    } catch {
      decoded = null
    }
    if (decoded === null) return

    let rawJson: string
    try {
      rawJson = JSON.stringify(encoded)
    } catch {
      return
    }

    // Refuse single entry that cannot fit even alone inside the budget.
    if (utf8Bytes(rawJson) + 64 > maxBytes) return

    const existing = envelope.entries[key]
    const cached = decodedCache.get(key)
    if (existing && existing.v === codec.version && cached?.rawJson === rawJson) {
      return
    }

    envelope.entries[key] = { v: codec.version, t: now(), d: encoded }
    decodedCache.set(key, { version: codec.version, rawJson, value: decoded })
    persist(key)
    notify()
  }

  function clearViewState(key: string): void {
    if (!(key in envelope.entries) && !decodedCache.has(key)) return
    delete envelope.entries[key]
    decodedCache.delete(key)
    persist()
    notify()
  }

  function scrollKey(entryId: string, routeKey: string): string {
    return `${entryId}@@${routeKey}`
  }

  function setScroll(entryId: string, routeKey: string, pos: ScrollPosition): void {
    if (!entryId) return
    const key = scrollKey(entryId, routeKey)
    const x = Math.max(0, Math.round(pos.x))
    const y = Math.max(0, Math.round(pos.y))
    const existing = envelope.scrolls[key]
    if (existing && existing.x === x && existing.y === y) return
    envelope.scrolls[key] = { x, y, t: now() }
    persist(key)
  }

  function getScroll(entryId: string, routeKey: string): ScrollPosition | null {
    if (!entryId) return null
    const entry = envelope.scrolls[scrollKey(entryId, routeKey)]
    return entry ? { x: entry.x, y: entry.y } : null
  }

  function setPendingReturnScroll(targetHref: string, originId: string): void {
    pendingReturnScroll = { targetHref, originId }
  }

  function consumePendingReturnScroll(currentHref: string): string | null {
    if (!pendingReturnScroll) return null
    const { targetHref, originId } = pendingReturnScroll
    if (targetHref !== currentHref) return null
    pendingReturnScroll = null
    return originId
  }

  function setSnapshot<T>(key: string, value: T): void {
    memorySnapshots.delete(key)
    memorySnapshots.set(key, { value, epoch: mutationEpoch, storedAt: now() })
    while (memorySnapshots.size > maxMemorySnapshots) {
      const oldestKey = memorySnapshots.keys().next().value
      if (oldestKey === undefined) break
      memorySnapshots.delete(oldestKey)
    }
    notify()
  }

  function getSnapshotRecord<T>(key: string): MemorySnapshotRecord<T> | null {
    const found = memorySnapshots.get(key)
    if (!found) return null
    // Touch LRU order
    memorySnapshots.delete(key)
    memorySnapshots.set(key, found)
    return {
      value: found.value as T,
      epoch: found.epoch,
      invalid: found.epoch !== mutationEpoch,
      storedAt: found.storedAt,
    }
  }

  function clearSnapshot(key?: string): void {
    if (key === undefined) {
      if (memorySnapshots.size === 0) return
      memorySnapshots.clear()
      notify()
      return
    }
    if (memorySnapshots.delete(key)) notify()
  }

  function setEphemeral<T>(key: string, value: T): void {
    ephemeralState.delete(key)
    ephemeralState.set(key, { value, epoch: mutationEpoch })
    while (ephemeralState.size > maxMemorySnapshots) {
      const oldestKey = ephemeralState.keys().next().value
      if (oldestKey === undefined) break
      ephemeralState.delete(oldestKey)
    }
  }

  function getEphemeral<T>(key: string): { value: T; invalid: boolean } | null {
    const found = ephemeralState.get(key)
    if (!found) return null
    return { value: found.value as T, invalid: found.epoch !== mutationEpoch }
  }

  function clearEphemeral(key: string): void {
    ephemeralState.delete(key)
  }

  function bumpMutationEpoch(_reason?: MutationReason): number {
    void _reason
    mutationEpoch += 1
    notify()
    return mutationEpoch
  }

  function setActiveNavigation(entryId: string | null, url: string, routeKey?: string | null): void {
    const nextRouteKey = routeKey === undefined ? activeRouteKey : routeKey
    if (activeEntryId === entryId && currentUrl === url && activeRouteKey === nextRouteKey) return
    activeEntryId = entryId
    currentUrl = url
    if (routeKey !== undefined) activeRouteKey = routeKey
    notify()
  }

  function setActiveRouteKey(routeKey: string | null): void {
    activeRouteKey = routeKey
  }

  return {
    hydrate,
    isHydrated: () => hydrated,
    getRevision: () => revision,
    getActiveEntryId: () => activeEntryId,
    getCurrentUrl: () => currentUrl,
    getActiveRouteKey: () => activeRouteKey,
    setActiveNavigation,
    setActiveRouteKey,
    getMutationEpoch: () => mutationEpoch,
    bumpMutationEpoch,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    readViewState,
    writeViewState,
    clearViewState,
    setScroll,
    getScroll,
    setPendingReturnScroll,
    consumePendingReturnScroll,
    setSnapshot,
    getSnapshotRecord,
    clearSnapshot,
    setEphemeral,
    getEphemeral,
    clearEphemeral,
  }
}

export type NavigationStore = ReturnType<typeof createNavigationStore>

let defaultStore: NavigationStore | null = null

export function getDefaultNavigationStore(): NavigationStore {
  if (defaultStore === null) {
    defaultStore = createNavigationStore()
  }
  return defaultStore
}

export function invalidateNavigationSnapshots(reason: MutationReason = "manual"): number {
  return getDefaultNavigationStore().bumpMutationEpoch(reason)
}
