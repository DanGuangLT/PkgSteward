import { test } from "node:test"
import assert from "node:assert/strict"
import { diskSizeKind, diskUsageHref, sortDiskRows } from "./disk-usage-list.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const row = (name, path, sizeBytes) => ({
  name, path, sizeBytes, kind: "directory", canonicalPath: path, aliases: [],
  state: sizeBytes === null ? "pending" : "complete", fileCount: null, reason: null,
})

test("size descending with zero and null", () => {
  const rows = [row("TEST-a", "a", null), row("TEST-b", "b", 0), row("TEST-c", "c", 20), row("TEST-d", "d", 3)]
  assert.deepEqual(sortDiskRows(rows, "vi").map(({ sizeBytes }) => sizeBytes), [20, 3, 0, null])
})

test("locale tie path stable", () => {
  for (const locale of ["vi", "en", "sv"]) {
    for (const size of [5, null]) {
      const rows = [row("TEST-ä", "b", size), row("TEST-z", "a", size), row("TEST-ä", "a", size)]
      const expected = [...rows].sort((a, b) => a.name.localeCompare(b.name, locale) || a.path.localeCompare(b.path, locale))
      assert.deepEqual(sortDiskRows(rows, locale), expected)
    }
  }
})

test("sort immutable", () => {
  const rows = Object.freeze([Object.freeze(row("TEST-low", "a", 0)), Object.freeze(row("TEST-high", "b", 4))])
  const sorted = sortDiskRows(rows, "vi")
  assert.notEqual(sorted, rows)
  assert.equal(rows[0].sizeBytes, 0)
  assert.equal(sorted[0], rows[1])
})

test("href round trips Windows Unicode path", () => {
  for (const path of ["D:\\TEST\\Thư mục # & +%?\\node_modules", "\\\\TEST-server\\ổ đĩa\\dự án"]) {
    for (const view of ["directory", "packages"]) {
      const href = diskUsageHref(path, view)
      const url = new URL(href, "http://localhost")
      assert.equal(url.pathname, "/disk-usage")
      assert.equal(url.hash, "")
      assert.equal(url.searchParams.get("path"), path)
      assert.equal(url.searchParams.get("view"), view)
      assert.equal([...url.searchParams].length, 2)
    }
  }
})

test("partial never displayed as exact", () => {
  for (const partial of [false, true]) assert.equal(diskSizeKind(null, partial), "pending")
  for (const size of [0, 1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(diskSizeKind(size, true), "lower_bound")
    assert.equal(diskSizeKind(size, false), "exact")
  }
})
