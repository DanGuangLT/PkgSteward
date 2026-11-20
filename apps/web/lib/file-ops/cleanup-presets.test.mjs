import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BUILTIN_CLEANUP_PRESETS,
  MAX_CUSTOM_PRESETS,
  MAX_PRESET_NAME_LENGTH,
  deleteCustomPreset,
  matchBuiltinPreset,
  parseStoredPresets,
  reconcileProjectPaths,
  serializePresets,
  upsertCustomPreset,
} from "./cleanup-presets.ts"
import { cleanupPreviewInput } from "./file-ops-list.ts"

test("4 built-in presets cover non-expert default and expert scopes with valid inputs", () => {
  assert.deepEqual(
    BUILTIN_CLEANUP_PRESETS.map((preset) => preset.id),
    ["safe-recommended", "all-node-modules", "build-caches", "deep-clean"],
  )
  const recommended = BUILTIN_CLEANUP_PRESETS[0]
  assert.equal(recommended.recommended, true)
  assert.deepEqual(recommended.form, {
    kinds: ["node_modules"],
    olderThanDays: "30",
    minSizeMib: "",
    projectPaths: [],
  })
  for (const preset of BUILTIN_CLEANUP_PRESETS) {
    assert.notEqual(cleanupPreviewInput(preset.form), null, `preset ${preset.id} must produce valid input`)
  }
})

test("matchBuiltinPreset ignores kind order and rejects custom criteria", () => {
  assert.equal(
    matchBuiltinPreset({
      kinds: ["build_cache", "orphan_node_modules", "node_modules"],
      olderThanDays: "",
      minSizeMib: "",
      projectPaths: [],
    }),
    "deep-clean",
  )
  assert.equal(
    matchBuiltinPreset({
      kinds: ["node_modules"],
      olderThanDays: "30",
      minSizeMib: "",
      projectPaths: ["D:\\TEST\\app"],
    }),
    null,
  )
  assert.equal(
    matchBuiltinPreset({
      kinds: ["node_modules"],
      olderThanDays: "90",
      minSizeMib: "",
      projectPaths: [],
    }),
    null,
  )
})

test("parseStoredPresets and serializePresets validate schema and drop corrupt entries", () => {
  assert.deepEqual(parseStoredPresets(null), [])
  assert.deepEqual(parseStoredPresets("not-json"), [])
  assert.deepEqual(parseStoredPresets(JSON.stringify({ version: 99, presets: [] })), [])

  const raw = JSON.stringify({
    version: 1,
    presets: [
      {
        id: "p1",
        name: "  Old Heavy Caches  ",
        form: {
          kinds: ["build_cache", "node_modules", "build_cache"],
          olderThanDays: "60",
          minSizeMib: "100",
          projectPaths: ["D:\\TEST\\a", "D:\\TEST\\a"],
        },
        updatedAt: "2026-11-20T00:00:00.000Z",
      },
      {
        id: "bad-empty-name",
        name: "   ",
        form: { kinds: ["node_modules"], olderThanDays: "", minSizeMib: "", projectPaths: [] },
        updatedAt: "2026-11-20T00:00:00.000Z",
      },
      {
        id: "bad-negative-age",
        name: "Bad",
        form: { kinds: ["node_modules"], olderThanDays: "-5", minSizeMib: "", projectPaths: [] },
        updatedAt: "2026-11-20T00:00:00.000Z",
      },
    ],
  })
  const parsed = parseStoredPresets(raw)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].name, "Old Heavy Caches")
  assert.deepEqual(parsed[0].form, {
    kinds: ["build_cache", "node_modules"],
    olderThanDays: "60",
    minSizeMib: "100",
    projectPaths: ["D:\\TEST\\a"],
  })
  assert.deepEqual(parseStoredPresets(serializePresets(parsed)), parsed)
})

test("upsertCustomPreset creates, updates, enforces limits, and rejects invalid drafts", () => {
  const form = { kinds: ["node_modules"], olderThanDays: "14", minSizeMib: "50", projectPaths: [] }
  const created = upsertCustomPreset([], { name: "  My Preset ", form }, "2026-11-20T01:00:00.000Z", () => "id-1")
  assert.equal(created.ok, true)
  assert.equal(created.presets.length, 1)
  assert.equal(created.preset.id, "id-1")
  assert.equal(created.preset.name, "My Preset")

  const updated = upsertCustomPreset(
    created.presets,
    { id: "id-1", name: "Renamed", form: { ...form, olderThanDays: "7" } },
    "2026-11-20T02:00:00.000Z",
    () => "id-2",
  )
  assert.equal(updated.ok, true)
  assert.equal(updated.presets.length, 1)
  assert.equal(updated.preset.name, "Renamed")
  assert.equal(updated.preset.form.olderThanDays, "7")

  const emptyName = upsertCustomPreset([], { name: "   ", form }, "2026-11-20T01:00:00.000Z")
  assert.deepEqual(emptyName, { ok: false, reason: "empty_name" })

  const tooLong = upsertCustomPreset([], { name: "a".repeat(MAX_PRESET_NAME_LENGTH + 1), form }, "2026-11-20T01:00:00.000Z")
  assert.deepEqual(tooLong, { ok: false, reason: "name_too_long" })

  const invalidForm = upsertCustomPreset([], { name: "Bad", form: { ...form, kinds: [] } }, "2026-11-20T01:00:00.000Z")
  assert.deepEqual(invalidForm, { ok: false, reason: "invalid_criteria" })

  let full = []
  for (let i = 0; i < MAX_CUSTOM_PRESETS; i += 1) {
    const next = upsertCustomPreset(full, { name: `Preset ${i}`, form }, "2026-11-20T01:00:00.000Z", () => `id-${i}`)
    assert.equal(next.ok, true)
    full = next.presets
  }
  assert.deepEqual(upsertCustomPreset(full, { name: "Overflow", form }, "2026-11-20T01:00:00.000Z"), {
    ok: false,
    reason: "limit_reached",
  })
  // Updating an existing preset when at capacity is still allowed.
  const editAtCap = upsertCustomPreset(full, { id: "id-0", name: "Edited 0", form }, "2026-11-20T03:00:00.000Z")
  assert.equal(editAtCap.ok, true)
  assert.equal(editAtCap.presets.length, MAX_CUSTOM_PRESETS)

  const afterDelete = deleteCustomPreset(full, "id-0")
  assert.equal(afterDelete.length, MAX_CUSTOM_PRESETS - 1)
  assert.equal(full.length, MAX_CUSTOM_PRESETS)
})

test("reconcileProjectPaths splits matched and missing scanned project paths", () => {
  const scanned = new Set(["D:\\TEST\\app-a", "D:\\TEST\\app-b"])
  const result = reconcileProjectPaths(["D:\\TEST\\app-a", "D:\\TEST\\gone", "D:\\TEST\\app-a"], scanned)
  assert.deepEqual(result, {
    matched: ["D:\\TEST\\app-a"],
    missing: ["D:\\TEST\\gone"],
  })
})
