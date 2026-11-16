import { test } from "node:test"
import assert from "node:assert/strict"
import { selectDiskRows, DISK_DISCOVERY, diskDiscoveryCodec } from "./discovery.ts"
test("disk filters intersect aliases/kinds/states and minimum known size; zero is known, unknown sorts last", () => {
  const row = (path, overrides = {}) => ({ path, name: path, aliases: [], kind: "file", state: "complete", sizeBytes: null, ...overrides })
  const zero = row("TEST-zero", { sizeBytes: 0 }), large = row("TEST-large", { kind: "package", sizeBytes: 20, aliases: ["TEST-alias"] })
  const unknown = row("TEST-unknown")
  const input = Object.freeze([unknown, zero, large])
  assert.deepEqual(selectDiskRows(input, DISK_DISCOVERY, "en"), [large, zero, unknown])
  assert.deepEqual(selectDiskRows(input, { ...DISK_DISCOVERY, minSize: "0" }, "en"), [large, zero])
  assert.deepEqual(selectDiskRows(input, { ...DISK_DISCOVERY, query: " ALIAS ", kinds: ["package", "directory"], states: ["complete"] }, "en"), [large])
  assert.equal(diskDiscoveryCodec.decode({ ...DISK_DISCOVERY, minSize: "-1" }), null)
  assert.deepEqual(input, [unknown, zero, large])
})
