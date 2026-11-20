import type { CleanupKind } from "@/lib/api/types"
import { cleanupPreviewInput, type CleanupFilterForm } from "./file-ops-list.ts"

export type BuiltinPresetId = "safe-recommended" | "all-node-modules" | "build-caches" | "deep-clean"

export interface BuiltinCleanupPreset {
  id: BuiltinPresetId
  recommended?: boolean
  form: Required<CleanupFilterForm>
}

export interface CustomCleanupPreset {
  id: string
  name: string
  form: Required<CleanupFilterForm>
  updatedAt: string
}

export interface CustomPresetDraft {
  id?: string
  name: string
  form: CleanupFilterForm
}

export type UpsertPresetResult =
  | { ok: true; presets: CustomCleanupPreset[]; preset: CustomCleanupPreset }
  | { ok: false; reason: "empty_name" | "name_too_long" | "invalid_criteria" | "limit_reached" }

const STORAGE_VERSION = 1
export const CUSTOM_PRESETS_STORAGE_KEY = "pkgsteward.cleanup.customPresets.v1"
export const MAX_CUSTOM_PRESETS = 12
export const MAX_PRESET_NAME_LENGTH = 48

const VALID_KINDS: readonly CleanupKind[] = ["node_modules", "orphan_node_modules", "build_cache"]

export const BUILTIN_CLEANUP_PRESETS: readonly BuiltinCleanupPreset[] = [
  {
    id: "safe-recommended",
    recommended: true,
    form: {
      kinds: ["node_modules"],
      olderThanDays: "30",
      minSizeMib: "",
      projectPaths: [],
    },
  },
  {
    id: "all-node-modules",
    form: {
      kinds: ["node_modules"],
      olderThanDays: "",
      minSizeMib: "",
      projectPaths: [],
    },
  },
  {
    id: "build-caches",
    form: {
      kinds: ["build_cache"],
      olderThanDays: "",
      minSizeMib: "",
      projectPaths: [],
    },
  },
  {
    id: "deep-clean",
    form: {
      kinds: ["node_modules", "orphan_node_modules", "build_cache"],
      olderThanDays: "",
      minSizeMib: "",
      projectPaths: [],
    },
  },
]

export const QUICK_AGE_DAYS = ["", "7", "30", "90", "180"] as const
export const QUICK_MIN_SIZE_MIB = ["", "50", "100", "500", "1024"] as const

function isCleanupKind(value: unknown): value is CleanupKind {
  return typeof value === "string" && VALID_KINDS.includes(value as CleanupKind)
}

export function normalizeCleanupForm(form: CleanupFilterForm): Required<CleanupFilterForm> {
  const seenKinds = new Set<CleanupKind>()
  const kinds: CleanupKind[] = []
  for (const kind of form.kinds) {
    if (isCleanupKind(kind) && !seenKinds.has(kind)) {
      seenKinds.add(kind)
      kinds.push(kind)
    }
  }
  const seenPaths = new Set<string>()
  const projectPaths: string[] = []
  for (const raw of form.projectPaths ?? []) {
    if (typeof raw !== "string") continue
    const trimmed = raw.trim()
    if (trimmed && !seenPaths.has(trimmed)) {
      seenPaths.add(trimmed)
      projectPaths.push(trimmed)
    }
  }
  return {
    kinds,
    olderThanDays: form.olderThanDays.trim(),
    minSizeMib: form.minSizeMib.trim(),
    projectPaths,
  }
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((item) => set.has(item))
}

export function matchBuiltinPreset(form: CleanupFilterForm): BuiltinPresetId | null {
  const normalized = normalizeCleanupForm(form)
  if (normalized.projectPaths.length > 0) return null
  for (const preset of BUILTIN_CLEANUP_PRESETS) {
    if (
      preset.form.olderThanDays === normalized.olderThanDays
      && preset.form.minSizeMib === normalized.minSizeMib
      && sameStringSet(preset.form.kinds, normalized.kinds)
    ) {
      return preset.id
    }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseSinglePreset(raw: unknown): CustomCleanupPreset | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== "string" || !raw.id.trim()) return null
  if (typeof raw.name !== "string") return null
  const name = raw.name.trim()
  if (!name || name.length > MAX_PRESET_NAME_LENGTH) return null
  if (!isRecord(raw.form)) return null
  if (!Array.isArray(raw.form.kinds)) return null
  if (typeof raw.form.olderThanDays !== "string" || typeof raw.form.minSizeMib !== "string") return null
  const rawPaths = raw.form.projectPaths === undefined ? [] : raw.form.projectPaths
  if (!Array.isArray(rawPaths) || rawPaths.some((item) => typeof item !== "string")) return null

  const normalized = normalizeCleanupForm({
    kinds: raw.form.kinds.filter(isCleanupKind),
    olderThanDays: raw.form.olderThanDays,
    minSizeMib: raw.form.minSizeMib,
    projectPaths: rawPaths,
  })
  if (cleanupPreviewInput(normalized) === null) return null

  return {
    id: raw.id.trim(),
    name,
    form: normalized,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt : new Date(0).toISOString(),
  }
}

export function parseStoredPresets(raw: string | null): CustomCleanupPreset[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.presets)) return []
    const seenIds = new Set<string>()
    const result: CustomCleanupPreset[] = []
    for (const item of parsed.presets) {
      const preset = parseSinglePreset(item)
      if (!preset || seenIds.has(preset.id)) continue
      seenIds.add(preset.id)
      result.push(preset)
      if (result.length >= MAX_CUSTOM_PRESETS) break
    }
    return result
  } catch {
    return []
  }
}

export function serializePresets(presets: readonly CustomCleanupPreset[]): string {
  return JSON.stringify({ version: STORAGE_VERSION, presets })
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function upsertCustomPreset(
  presets: readonly CustomCleanupPreset[],
  draft: CustomPresetDraft,
  nowIso: string = new Date().toISOString(),
  makeId: () => string = defaultId,
): UpsertPresetResult {
  const name = draft.name.trim()
  if (!name) return { ok: false, reason: "empty_name" }
  if (name.length > MAX_PRESET_NAME_LENGTH) return { ok: false, reason: "name_too_long" }
  const normalized = normalizeCleanupForm(draft.form)
  if (cleanupPreviewInput(normalized) === null) return { ok: false, reason: "invalid_criteria" }

  const existingIndex = draft.id ? presets.findIndex((item) => item.id === draft.id) : -1
  if (existingIndex === -1 && presets.length >= MAX_CUSTOM_PRESETS) {
    return { ok: false, reason: "limit_reached" }
  }

  const preset: CustomCleanupPreset = {
    id: existingIndex === -1 ? makeId() : presets[existingIndex].id,
    name,
    form: normalized,
    updatedAt: nowIso,
  }
  if (existingIndex === -1) {
    return { ok: true, presets: [...presets, preset], preset }
  }
  const next = [...presets]
  next[existingIndex] = preset
  return { ok: true, presets: next, preset }
}

export function deleteCustomPreset(
  presets: readonly CustomCleanupPreset[],
  id: string,
): CustomCleanupPreset[] {
  return presets.filter((preset) => preset.id !== id)
}

export function reconcileProjectPaths(
  projectPaths: readonly string[],
  scannedPaths: ReadonlySet<string>,
): { matched: string[]; missing: string[] } {
  const seen = new Set<string>()
  const matched: string[] = []
  const missing: string[] = []
  for (const raw of projectPaths) {
    const trimmed = raw.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    if (scannedPaths.has(trimmed)) matched.push(trimmed)
    else missing.push(trimmed)
  }
  return { matched, missing }
}
