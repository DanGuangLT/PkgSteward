import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addDiskFavorite,
  DISK_FAVORITES_STORAGE_KEY,
  isPathFavorited,
  MAX_DISK_FAVORITES,
  parseStoredDiskFavorites,
  removeDiskFavorite,
  serializeDiskFavorites,
} from "./disk-usage-favorites.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
test("storage key and bounds match versioned schema", () => {
  assert.equal(DISK_FAVORITES_STORAGE_KEY, "pkgsteward.diskUsage.favorites.v1")
  assert.equal(MAX_DISK_FAVORITES, 8)
})

test("addDiskFavorite trims path, derives default label from basename, and blocks duplicates case-insensitively", () => {
  const first = addDiskFavorite(
    [],
    { path: "  D:\\TEST\\Projects\\app\\  ", view: "directory" },
    "2026-11-20T00:00:00.000Z",
    () => "fav-1",
  )
  assert.equal(first.ok, true)
  if (!first.ok) return
  assert.equal(first.favorite.id, "fav-1")
  assert.equal(first.favorite.path, "D:\\TEST\\Projects\\app")
  assert.equal(first.favorite.label, "app")
  assert.equal(first.favorite.view, "directory")

  const dup = addDiskFavorite(first.favorites, { path: "d:\\test\\projects\\app", view: "directory" })
  assert.deepEqual(dup, { ok: false, reason: "duplicate" })

  const dupSlash = addDiskFavorite(first.favorites, { path: "D:/TEST/Projects/app/", view: "directory" })
  assert.deepEqual(dupSlash, { ok: false, reason: "duplicate" })

  const tooLong = addDiskFavorite(first.favorites, { path: `D:\\TEST\\${"a".repeat(32770)}`, view: "directory" })
  assert.deepEqual(tooLong, { ok: false, reason: "path_too_long" })

  const diffView = addDiskFavorite(
    first.favorites,
    { path: "D:\\TEST\\Projects\\app", view: "packages", label: "Custom Label" },
    "2026-11-20T00:01:00.000Z",
    () => "fav-2",
  )
  assert.equal(diffView.ok, true)
  if (!diffView.ok) return
  assert.equal(diffView.favorite.label, "Custom Label")
  assert.equal(isPathFavorited(diffView.favorites, "D:\\TEST\\Projects\\app", "packages")?.id, "fav-2")
})

test("addDiskFavorite enforces empty path and MAX_DISK_FAVORITES cap", () => {
  assert.deepEqual(addDiskFavorite([], { path: "   ", view: "directory" }), { ok: false, reason: "empty_path" })

  let list = []
  for (let i = 0; i < MAX_DISK_FAVORITES; i++) {
    const res = addDiskFavorite(list, { path: `D:\\TEST\\p-${i}`, view: "directory" }, "2026-11-20T00:00:00.000Z", () => `id-${i}`)
    assert.equal(res.ok, true)
    if (res.ok) list = res.favorites
  }
  assert.equal(list.length, MAX_DISK_FAVORITES)
  assert.deepEqual(
    addDiskFavorite(list, { path: "D:\\TEST\\overflow", view: "directory" }),
    { ok: false, reason: "limit_reached" },
  )
})

test("parseStoredDiskFavorites safely parses valid payload and discards corrupt or mismatched versions", () => {
  assert.deepEqual(parseStoredDiskFavorites(null), [])
  assert.deepEqual(parseStoredDiskFavorites("{not-json"), [])
  assert.deepEqual(parseStoredDiskFavorites(JSON.stringify({ version: 99, favorites: [] })), [])

  const res = addDiskFavorite([], { path: "D:\\TEST\\root", view: "directory", label: "Root" }, "2026-11-20T00:00:00.000Z", () => "f1")
  assert.equal(res.ok, true)
  if (!res.ok) return
  const raw = serializeDiskFavorites(res.favorites)
  const parsed = parseStoredDiskFavorites(raw)
  assert.deepEqual(parsed, res.favorites)
  assert.deepEqual(removeDiskFavorite(parsed, "f1"), [])
})
