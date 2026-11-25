export const DISMISSED_GLOBAL_PREVIEWS_KEY = "pkgsteward.global-packages.dismissed-previews.v1"
export const DISMISSED_GLOBAL_PREVIEWS_MAX = 32

export interface DismissedPreviewStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface DismissedPreviewTracker {
  has(id: string | null | undefined): boolean
  add(id: string | null | undefined): void
}

function browserSessionStorage(): DismissedPreviewStorage | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null
  } catch {
    return null
  }
}

function isValidPreviewId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.trim().length > 0
}

function loadStoredIds(storage: DismissedPreviewStorage | null, maxEntries: number): string[] {
  if (!storage || maxEntries <= 0) return []
  try {
    const raw = storage.getItem(DISMISSED_GLOBAL_PREVIEWS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid = parsed.filter((item): item is string => isValidPreviewId(item))
    return valid.slice(-maxEntries)
  } catch {
    return []
  }
}

export function createDismissedPreviewTracker(options?: {
  storage?: DismissedPreviewStorage | null
  maxEntries?: number
}): DismissedPreviewTracker {
  const maxEntries = options?.maxEntries ?? DISMISSED_GLOBAL_PREVIEWS_MAX
  const storage = options?.storage === undefined ? browserSessionStorage() : options.storage
  const dismissed = new Set<string>(loadStoredIds(storage, maxEntries))

  function persist(): void {
    if (!storage) return
    try {
      storage.setItem(DISMISSED_GLOBAL_PREVIEWS_KEY, JSON.stringify([...dismissed]))
    } catch {
      // Blocked/quota-full sessionStorage keeps in-memory dismissal active.
    }
  }

  return {
    has(id) {
      return isValidPreviewId(id) && dismissed.has(id)
    },
    add(id) {
      if (!isValidPreviewId(id) || maxEntries <= 0) return
      dismissed.delete(id)
      dismissed.add(id)
      while (dismissed.size > maxEntries) {
        const oldest = dismissed.values().next().value
        if (oldest === undefined) break
        dismissed.delete(oldest)
      }
      persist()
    },
  }
}

let defaultTracker: DismissedPreviewTracker | null = null

export function getDefaultDismissedGlobalPreviews(): DismissedPreviewTracker {
  if (defaultTracker === null) {
    defaultTracker = createDismissedPreviewTracker()
  }
  return defaultTracker
}
