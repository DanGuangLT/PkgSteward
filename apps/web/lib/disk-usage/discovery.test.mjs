import { test } from "node:test"
import assert from "node:assert/strict"
import {
  defaultDiskSortDirection,
  DISK_DISCOVERY,
  diskDiscoveryCodec,
  selectDiskRows,
} from "./discovery.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
test("disk filters intersect aliases/kinds/states and minimum known size; zero is known, unknown sorts last", () => {
  const row = (path, overrides = {}) => ({ path, name: path, aliases: [], kind: "file", state: "complete", sizeBytes: null, fileCount: null, ...overrides })
  const zero = row("TEST-zero", { sizeBytes: 0 }), large = row("TEST-large", { kind: "package", sizeBytes: 20, aliases: ["TEST-alias"] })
  const unknown = row("TEST-unknown")
  const input = Object.freeze([unknown, zero, large])
  assert.deepEqual(selectDiskRows(input, DISK_DISCOVERY, "en"), [large, zero, unknown])
  assert.deepEqual(selectDiskRows(input, { ...DISK_DISCOVERY, minSize: "0" }, "en"), [large, zero])
  assert.deepEqual(selectDiskRows(input, { ...DISK_DISCOVERY, query: " ALIAS ", kinds: ["package", "directory"], states: ["complete"] }, "en"), [large])
  assert.equal(diskDiscoveryCodec.decode({ ...DISK_DISCOVERY, minSize: "-1" }), null)
  assert.deepEqual(input, [unknown, zero, large])
})

test("disk sorting supports size, name, and fileCount in both directions with nulls last", () => {
  const row = (name, sizeBytes, fileCount) => ({
    path: `D:\\TEST\\${name}`,
    name,
    aliases: [],
    kind: "directory",
    state: "complete",
    sizeBytes,
    fileCount,
  })
  const a = row("TEST-alpha", 10, 50)
  const b = row("TEST-beta", 30, 5)
  const c = row("TEST-gamma", null, null)
  const rows = [c, a, b]

  assert.equal(defaultDiskSortDirection("name"), "asc")
  assert.equal(defaultDiskSortDirection("size"), "desc")
  assert.equal(defaultDiskSortDirection("files"), "desc")

  assert.deepEqual(selectDiskRows(rows, { ...DISK_DISCOVERY, sort: "size", sortDir: "asc" }, "en"), [a, b, c])
  assert.deepEqual(selectDiskRows(rows, { ...DISK_DISCOVERY, sort: "files", sortDir: "desc" }, "en"), [a, b, c])
  assert.deepEqual(selectDiskRows(rows, { ...DISK_DISCOVERY, sort: "files", sortDir: "asc" }, "en"), [b, a, c])
  assert.deepEqual(selectDiskRows(rows, { ...DISK_DISCOVERY, sort: "name", sortDir: "desc" }, "en"), [c, b, a])
})
