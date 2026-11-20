"use client"

import { useCallback, useSyncExternalStore } from "react"

import {
  CUSTOM_PRESETS_STORAGE_KEY,
  deleteCustomPreset,
  parseStoredPresets,
  serializePresets,
  upsertCustomPreset,
  type CustomCleanupPreset,
  type CustomPresetDraft,
  type UpsertPresetResult,
} from "@/lib/file-ops/cleanup-presets"

const EMPTY_PRESETS: readonly CustomCleanupPreset[] = []
const listeners = new Set<() => void>()

let cachedRaw: string | null | undefined
let cachedPresets: readonly CustomCleanupPreset[] = EMPTY_PRESETS
let storageFallback = false

function readStorageRaw(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(CUSTOM_PRESETS_STORAGE_KEY)
  } catch {
    return null
  }
}

function getSnapshot(): readonly CustomCleanupPreset[] {
  if (storageFallback) return cachedPresets
  const raw = readStorageRaw()
  if (raw === cachedRaw) return cachedPresets
  cachedRaw = raw
  const parsed = parseStoredPresets(raw)
  cachedPresets = parsed.length === 0 ? EMPTY_PRESETS : parsed
  return cachedPresets
}

function getServerSnapshot(): readonly CustomCleanupPreset[] {
  return EMPTY_PRESETS
}

function emitChange() {
  for (const listener of listeners) listener()
}

function writePresets(next: readonly CustomCleanupPreset[]) {
  const serialized = serializePresets(next)
  cachedRaw = serialized
  cachedPresets = next.length === 0 ? EMPTY_PRESETS : next
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CUSTOM_PRESETS_STORAGE_KEY, serialized)
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
    if (event.key !== null && event.key !== CUSTOM_PRESETS_STORAGE_KEY) return
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

export function useCustomCleanupPresets() {
  const presets = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const savePreset = useCallback((draft: CustomPresetDraft): UpsertPresetResult => {
    const current = getSnapshot()
    const result = upsertCustomPreset(current, draft)
    if (result.ok) writePresets(result.presets)
    return result
  }, [])

  const removePreset = useCallback((id: string) => {
    const current = getSnapshot()
    const next = deleteCustomPreset(current, id)
    if (next.length !== current.length) writePresets(next)
  }, [])

  return { presets, savePreset, removePreset }
}
