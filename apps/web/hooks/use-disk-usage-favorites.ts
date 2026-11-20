"use client"

import { useCallback, useSyncExternalStore } from "react"

import {
  addDiskFavorite,
  DISK_FAVORITES_STORAGE_KEY,
  parseStoredDiskFavorites,
  removeDiskFavorite,
  serializeDiskFavorites,
  type AddDiskFavoriteResult,
  type DiskFavoriteDraft,
  type DiskUsageFavorite,
} from "@/lib/disk-usage/disk-usage-favorites"

const EMPTY_FAVORITES: readonly DiskUsageFavorite[] = []
const listeners = new Set<() => void>()

let cachedRaw: string | null | undefined
let cachedFavorites: readonly DiskUsageFavorite[] = EMPTY_FAVORITES
let storageFallback = false

function readStorageRaw(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(DISK_FAVORITES_STORAGE_KEY)
  } catch {
    return null
  }
}

function getSnapshot(): readonly DiskUsageFavorite[] {
  if (storageFallback) return cachedFavorites
  const raw = readStorageRaw()
  if (raw === cachedRaw) return cachedFavorites
  cachedRaw = raw
  const parsed = parseStoredDiskFavorites(raw)
  cachedFavorites = parsed.length === 0 ? EMPTY_FAVORITES : parsed
  return cachedFavorites
}

function getServerSnapshot(): readonly DiskUsageFavorite[] {
  return EMPTY_FAVORITES
}

function emitChange() {
  for (const listener of listeners) listener()
}

function writeFavorites(next: readonly DiskUsageFavorite[]) {
  const serialized = serializeDiskFavorites(next)
  cachedRaw = serialized
  cachedFavorites = next.length === 0 ? EMPTY_FAVORITES : next
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DISK_FAVORITES_STORAGE_KEY, serialized)
      storageFallback = false
    } catch {
      // Storage blocked or quota exceeded: keep in-memory state for this session.
      storageFallback = true
    }
  }
  emitChange()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (typeof window === "undefined") return () => listeners.delete(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== DISK_FAVORITES_STORAGE_KEY) return
    storageFallback = false
    cachedRaw = undefined
    listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function useDiskUsageFavorites() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const addFavorite = useCallback((draft: DiskFavoriteDraft): AddDiskFavoriteResult => {
    const current = getSnapshot()
    const result = addDiskFavorite(current, draft)
    if (result.ok) writeFavorites(result.favorites)
    return result
  }, [])

  const removeFavorite = useCallback((id: string) => {
    const current = getSnapshot()
    const next = removeDiskFavorite(current, id)
    if (next.length !== current.length) writeFavorites(next)
  }, [])

  return { favorites, addFavorite, removeFavorite }
}
