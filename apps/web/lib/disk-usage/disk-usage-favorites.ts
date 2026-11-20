import type { DiskView } from "@/lib/api/types"

export interface DiskUsageFavorite {
  id: string
  label: string
  path: string
  view: DiskView
  updatedAt: string
}

export interface DiskFavoriteDraft {
  path: string
  view: DiskView
  label?: string
}

export type AddDiskFavoriteResult =
  | { ok: true; favorites: DiskUsageFavorite[]; favorite: DiskUsageFavorite }
  | { ok: false; reason: "empty_path" | "path_too_long" | "duplicate" | "limit_reached" }

const STORAGE_VERSION = 1
export const DISK_FAVORITES_STORAGE_KEY = "pkgsteward.diskUsage.favorites.v1"
export const MAX_DISK_FAVORITES = 8
export const MAX_FAVORITE_LABEL_LENGTH = 64
export const MAX_FAVORITE_PATH_LENGTH = 32768
const MAX_STORED_PAYLOAD_LENGTH = 524_288

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDiskView(value: unknown): value is DiskView {
  return value === "directory" || value === "packages"
}

export function normalizeDiskFavoritePath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ""
  // Preserve drive root like "C:\" while stripping redundant trailing slashes elsewhere.
  if (/^[A-Za-z]:[\\/]+$/.test(trimmed)) return `${trimmed.slice(0, 2)}\\`
  return trimmed.replace(/[\\/]+$/, "")
}

export function diskFavoriteComparisonKey(path: string, view: DiskView): string {
  return `${normalizeDiskFavoritePath(path).replaceAll("/", "\\").toLowerCase()}::${view}`
}

function deriveLabel(path: string, explicit?: string): string {
  const trimmed = explicit?.trim() ?? ""
  if (trimmed) return trimmed.slice(0, MAX_FAVORITE_LABEL_LENGTH)
  const clean = normalizeDiskFavoritePath(path)
  const leaf = clean.split(/[\\/]/).filter(Boolean).at(-1) ?? clean
  return leaf.slice(0, MAX_FAVORITE_LABEL_LENGTH)
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `disk-fav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function isPathFavorited(
  favorites: readonly DiskUsageFavorite[],
  path: string,
  view: DiskView,
): DiskUsageFavorite | null {
  const normalized = normalizeDiskFavoritePath(path)
  if (!normalized) return null
  const key = diskFavoriteComparisonKey(normalized, view)
  return favorites.find((item) => diskFavoriteComparisonKey(item.path, item.view) === key) ?? null
}

export function parseStoredDiskFavorites(raw: string | null): DiskUsageFavorite[] {
  if (!raw || raw.length > MAX_STORED_PAYLOAD_LENGTH) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.favorites)) return []
    const seenIds = new Set<string>()
    const seenKeys = new Set<string>()
    const result: DiskUsageFavorite[] = []
    for (const item of parsed.favorites) {
      if (!isRecord(item)) continue
      if (typeof item.id !== "string" || !item.id.trim()) continue
      if (typeof item.path !== "string") continue
      if (!isDiskView(item.view)) continue
      const path = normalizeDiskFavoritePath(item.path)
      if (!path || path.length > MAX_FAVORITE_PATH_LENGTH) continue
      const key = diskFavoriteComparisonKey(path, item.view)
      const id = item.id.trim()
      if (seenIds.has(id) || seenKeys.has(key)) continue
      seenIds.add(id)
      seenKeys.add(key)
      result.push({
        id,
        path,
        view: item.view,
        label: deriveLabel(path, typeof item.label === "string" ? item.label : undefined),
        updatedAt: typeof item.updatedAt === "string" && item.updatedAt.trim()
          ? item.updatedAt
          : new Date(0).toISOString(),
      })
      if (result.length >= MAX_DISK_FAVORITES) break
    }
    return result
  } catch {
    return []
  }
}

export function serializeDiskFavorites(favorites: readonly DiskUsageFavorite[]): string {
  return JSON.stringify({ version: STORAGE_VERSION, favorites })
}

export function addDiskFavorite(
  favorites: readonly DiskUsageFavorite[],
  draft: DiskFavoriteDraft,
  nowIso: string = new Date().toISOString(),
  makeId: () => string = defaultId,
): AddDiskFavoriteResult {
  const path = normalizeDiskFavoritePath(draft.path)
  if (!path) return { ok: false, reason: "empty_path" }
  if (path.length > MAX_FAVORITE_PATH_LENGTH) return { ok: false, reason: "path_too_long" }
  if (isPathFavorited(favorites, path, draft.view)) return { ok: false, reason: "duplicate" }
  if (favorites.length >= MAX_DISK_FAVORITES) return { ok: false, reason: "limit_reached" }

  const favorite: DiskUsageFavorite = {
    id: makeId(),
    path,
    view: draft.view,
    label: deriveLabel(path, draft.label),
    updatedAt: nowIso,
  }
  return { ok: true, favorites: [...favorites, favorite], favorite }
}

export function removeDiskFavorite(
  favorites: readonly DiskUsageFavorite[],
  id: string,
): DiskUsageFavorite[] {
  return favorites.filter((item) => item.id !== id)
}
