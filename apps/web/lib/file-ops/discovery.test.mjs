import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CLEANUP_DISCOVERY,
  RESULT_DISCOVERY,
  cleanupDiscoveryCodec,
  hiddenSelectedCount,
  selectCleanupTargets,
  selectLoadedTree,
  selectResults,
} from "./discovery.ts"
test("loaded-only tree matches retain ancestors without changing expansion or selection", () => {
  const folder = { name: "TEST-folder", path: "TEST/root/folder", type: "directory" }
  const match = { name: "TEST-match", path: "TEST/root/folder/match", type: "file" }
  const other = { name: "TEST-other", path: "TEST/root/other", type: "file" }
  const levels = new Map([["TEST/root", { status: "ready", entries: [folder, other] }], [folder.path, { status: "ready", entries: [match] }]])
  const expanded = new Set(), selected = new Set([other.path, match.path, "TEST/not-loaded"])
  const result = selectLoadedTree("TEST/root", levels, expanded, { query: "MATCH", kinds: ["file", "link"] })
  assert.deepEqual([...result.visiblePaths], [folder.path, match.path])
  assert.equal(result.count, 1)
  assert.equal(result.total, 3)
  assert.equal(hiddenSelectedCount(selected, result.visiblePaths), 2)
  assert.equal(expanded.size, 0)
  assert.equal(selected.size, 3)
  const reset = selectLoadedTree("TEST/root", levels, expanded, { query: "", kinds: [] })
  assert.deepEqual([...reset.visiblePaths], [folder.path, other.path])
})
test("cleanup filters preserve selected scope and risk/validity/kind intersections; results keep status order", () => {
  const a = { path: "TEST/a", owner: { name: "TEST-owner", path: "TEST" }, kind: "node_modules", valid: true, risk: { level: "high" }, size: { reclaimableBytes: 0 }, lastActivityAt: null }
  const b = { ...a, path: "TEST/b", valid: false, kind: null }
  const input = Object.freeze([a, b]), selected = new Set([a.path, b.path])
  const rows = selectCleanupTargets(input, { ...CLEANUP_DISCOVERY, query: " OWNER ", kinds: ["node_modules", "build_cache"], validities: ["valid"], risks: ["high", "low"] }, "en")
  assert.deepEqual(rows, [a])
  assert.equal(hiddenSelectedCount(selected, new Set(rows.map(row => row.path))), 1)
  assert.equal(selected.size, 2)
  const results = [{ path: "TEST/a", status: "success", kind: "node_modules" }, { path: "TEST/b", status: "failed", kind: "project" }]
  assert.deepEqual(selectResults(results, RESULT_DISCOVERY, "en"), [results[1], results[0]])
  assert.deepEqual(selectResults(results, { ...RESULT_DISCOVERY, statuses: ["success", "not_started"], kinds: ["node_modules"] }, "en"), [results[0]])
})

test("tree search ignores cached levels disconnected from the current root", () => {
  const levels = new Map([
    ["TEST/root", { status: "ready", entries: [{ name: "TEST-file", path: "TEST/root/file", type: "file" }] }],
    ["TEST/other", { status: "ready", entries: [{ name: "TEST-match", path: "TEST/other/match", type: "file" }] }],
  ])
  const result = selectLoadedTree("TEST/root", levels, new Set(), { query: "match", kinds: [] })
  assert.equal(result.total, 1)
  assert.equal(result.count, 0)
  assert.equal(result.visiblePaths.size, 0)
})

test("cleanup discovery supports lockfile filter, selectedOnly, sort direction, and codec defaults", () => {
  const withLock = {
    path: "TEST/with",
    owner: { name: "alpha", path: "TEST/alpha" },
    kind: "node_modules",
    valid: true,
    hasLockfile: true,
    risk: { level: "low" },
    size: { reclaimableBytes: 10 },
    lastActivityAt: null,
  }
  const noLock = {
    path: "TEST/without",
    owner: { name: "beta", path: "TEST/beta" },
    kind: "node_modules",
    valid: true,
    hasLockfile: false,
    risk: { level: "medium" },
    size: { reclaimableBytes: 50 },
    lastActivityAt: null,
  }
  const selected = new Set([withLock.path])
  assert.deepEqual(
    selectCleanupTargets([withLock, noLock], { ...CLEANUP_DISCOVERY, lockfiles: ["without"] }, "en", selected),
    [noLock],
  )
  assert.deepEqual(
    selectCleanupTargets([withLock, noLock], { ...CLEANUP_DISCOVERY, selectedOnly: true }, "en", selected),
    [withLock],
  )
  assert.deepEqual(
    selectCleanupTargets([withLock, noLock], { ...CLEANUP_DISCOVERY, sort: "size", sortDir: "asc" }, "en", selected),
    [withLock, noLock],
  )
  const legacyDecoded = cleanupDiscoveryCodec.decode({ query: "abc", kinds: [], validities: [], risks: [], sort: "age" })
  assert.equal(legacyDecoded.sort, "age")
  assert.deepEqual(legacyDecoded.lockfiles, [])
  assert.equal(legacyDecoded.selectedOnly, false)
  assert.equal(legacyDecoded.viewMode, "list")
})
