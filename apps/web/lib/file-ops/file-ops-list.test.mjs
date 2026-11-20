import { test } from "node:test"
import assert from "node:assert/strict"
import {
  applyQuickSelection, applyRangeSelection, cleanupPreviewInput, computeCleanupMetrics, fileManagerHref, fileOpsErrorKey,
  formatRelativeDays, groupTargetsByOwner, initialReviewSelection, isReviewTarget, operationCounts, resultErrorKey,
  reviewTotals, sortCleanupTargets, sortOperationResults, targetFailureKey,
} from "./file-ops-list.ts"
import { fileOpsInitialState } from "./file-ops-policy.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const size = (overrides = {}) => ({
  status: "done", apparentBytes: 10, sizeBytes: 10, reclaimableBytes: 4, sharedBytes: 6, fileCount: 1, ...overrides,
})
const target = (path, overrides = {}) => ({
  path, kind: "node_modules", method: "permanent", valid: true, failureCode: null, owner: null, nestedProjects: [],
  hasLockfile: true, lastActivityAt: "2026-01-01T00:00:00.000Z", size: size(), risk: { level: "low", reasons: [] },
  defaultSelected: false, ...overrides,
})
const preview = (source, targets) => ({ source, targets })

test("only valid measured targets can be reviewed", () => {
  assert.equal(isReviewTarget(target("a")), true)
  assert.equal(isReviewTarget(target("a", { valid: false })), false)
  for (const status of ["pending", "measuring", "failed", "cancelled"]) {
    assert.equal(isReviewTarget(target("a", { size: size({ status }) })), false)
  }
})

test("cleanup starts from the server's default selection, delete from every chosen path", () => {
  const targets = [
    target("yes", { defaultSelected: true }),
    target("no"),
    target("stopped", { defaultSelected: true, size: size({ status: "cancelled" }) }),
    target("invalid", { defaultSelected: true, valid: false }),
  ]
  assert.deepEqual([...initialReviewSelection(preview("cleanup", targets))], ["yes"])
  assert.deepEqual([...initialReviewSelection(preview("delete", targets))], ["yes", "no"])
})

test("size sort puts the most reclaimable first and unmeasured last", () => {
  const sorted = sortCleanupTargets([
    target("b", { size: size({ reclaimableBytes: 1 }) }),
    target("pending", { size: size({ status: "pending", reclaimableBytes: null }) }),
    target("a", { size: size({ reclaimableBytes: 9 }) }),
    target("c", { size: size({ reclaimableBytes: 1 }) }),
  ], "size", "en")
  assert.deepEqual(sorted.map(({ path }) => path), ["a", "b", "c", "pending"])
})

test("age sort puts the oldest first and unknown activity last, without mutating", () => {
  const input = [
    target("new", { lastActivityAt: "2026-06-01T00:00:00.000Z" }),
    target("unknown", { lastActivityAt: null }),
    target("old", { lastActivityAt: "2020-01-01T00:00:00.000Z" }),
  ]
  assert.deepEqual(sortCleanupTargets(input, "age", "en").map(({ path }) => path), ["old", "new", "unknown"])
  assert.equal(input[0].path, "new")
})

test("totals split permanent space from Recycle Bin space and ignore the unselected", () => {
  const targets = [
    target("a", { size: size({ reclaimableBytes: 3 }) }),
    target("b", { size: size({ reclaimableBytes: 5 }) }),
    target("c", { method: "recycle", size: size({ sizeBytes: 7, reclaimableBytes: 2 }) }),
    target("d", { size: size({ reclaimableBytes: 100 }) }),
  ]
  assert.deepEqual(reviewTotals(targets, new Set(["a", "b", "c"])), { count: 3, reclaimableBytes: 8, recycleBytes: 2 })
})

test("filters build the request, empty fields stay out", () => {
  assert.deepEqual(cleanupPreviewInput({ kinds: ["node_modules"], olderThanDays: "", minSizeMib: "" }), {
    includeKinds: ["node_modules"],
  })
  assert.deepEqual(cleanupPreviewInput({ kinds: ["build_cache", "node_modules"], olderThanDays: " 30 ", minSizeMib: "2" }), {
    includeKinds: ["build_cache", "node_modules"], olderThanDays: 30, minSizeBytes: 2097152,
  })
  assert.deepEqual(cleanupPreviewInput({ kinds: ["node_modules"], olderThanDays: "0", minSizeMib: "0" }), {
    includeKinds: ["node_modules"], olderThanDays: 0, minSizeBytes: 0,
  })
})

test("invalid filters build nothing", () => {
  for (const form of [
    { kinds: [], olderThanDays: "", minSizeMib: "" },
    { kinds: ["node_modules"], olderThanDays: "-1", minSizeMib: "" },
    { kinds: ["node_modules"], olderThanDays: "1.5", minSizeMib: "" },
    { kinds: ["node_modules"], olderThanDays: "abc", minSizeMib: "" },
    { kinds: ["node_modules"], olderThanDays: "", minSizeMib: "1e3" },
    { kinds: ["node_modules"], olderThanDays: "9007199254740992", minSizeMib: "" },
    { kinds: ["node_modules"], olderThanDays: "", minSizeMib: "9007199254740991" },
  ]) {
    assert.equal(cleanupPreviewInput(form), null)
  }
})

test("results count every status and estimate only successful permanent deletions", () => {
  const result = (status, overrides = {}) => ({
    path: status, kind: "node_modules", method: "permanent", status, errorCode: null, mayBePartial: false,
    reclaimableBytes: 5, ...overrides,
  })
  const operation = {
    results: [
      result("success"), result("success", { method: "recycle", reclaimableBytes: null }),
      result("failed", { errorCode: "FILE_IN_USE", mayBePartial: true }), result("not_started"), result("running"), result("pending"),
    ],
  }
  assert.deepEqual(operationCounts(operation), {
    success: 2, failed: 1, notStarted: 1, remaining: 2, recycled: 1, reclaimedBytes: 5,
  })
})

test("failed results come first, then skipped, then the rest in order", () => {
  const result = (path, status) => ({ path, status })
  const sorted = sortOperationResults([
    result("a", "success"), result("b", "not_started"), result("c", "failed"), result("d", "running"), result("e", "failed"),
  ])
  assert.deepEqual(sorted.map(({ path }) => path), ["c", "e", "b", "a", "d"])
})

test("unknown codes fall back to the generic message", () => {
  assert.equal(targetFailureKey("IS_LINK"), "failures.IS_LINK")
  assert.equal(targetFailureKey("TEST_NEW_CODE"), "failures.UNKNOWN")
  assert.equal(targetFailureKey(null), "failures.UNKNOWN")
  assert.equal(resultErrorKey("FILE_IN_USE"), "results.errors.FILE_IN_USE")
  assert.equal(resultErrorKey("RECYCLE_BIN_DISABLED"), "results.errors.RECYCLE_BIN_DISABLED")
  assert.equal(resultErrorKey("TEST_NEW_CODE"), "results.errors.UNKNOWN")
})

test("error messages depend on where the failure happened", () => {
  const key = (code, source, state = fileOpsInitialState) => fileOpsErrorKey({ code, paths: [], source }, state)
  const lost = { ...fileOpsInitialState, phase: "lost" }
  const reviewing = { ...fileOpsInitialState, phase: "reviewing" }
  assert.equal(key("NOT_FOUND", "start"), "errors.noScan")
  assert.equal(key("NOT_FOUND"), "errors.previewLost")
  assert.equal(key("NOT_FOUND", undefined, lost), "errors.operationLost")
  assert.equal(key("INTERNAL_SERVER_ERROR", undefined, { ...fileOpsInitialState, phase: "operating" }), "errors.generic")
  assert.equal(key("CONFLICT"), "errors.conflict")
  assert.equal(key("SCAN_CHANGED"), "errors.scanChanged")
  assert.equal(key("RISK_CHANGED"), "errors.riskChanged")
  assert.equal(key("TARGET_CHANGED"), "errors.targetChanged")
  assert.equal(key("VALIDATION_ERROR"), "errors.validation")
  assert.equal(key("PAYLOAD_TOO_LARGE"), "errors.tooLarge")
  assert.equal(key("RATE_LIMITED"), "errors.rateLimited")
  assert.equal(key("FORBIDDEN"), "errors.forbidden")
  assert.equal(key("BACKEND_UNAVAILABLE"), "errors.backendUnavailable")
  assert.equal(key("INVALID_RESPONSE"), "errors.invalidResponse")
  assert.equal(key("INTERNAL_SERVER_ERROR", undefined, reviewing), "errors.internal")
  assert.equal(key("TEST_NEW_CODE"), "errors.generic")
})

test("file manager link round-trips the project path", () => {
  const path = "D:\\TEST\\Thư mục # & +"
  const url = new URL(fileManagerHref(path), "http://127.0.0.1")
  assert.equal(url.pathname, "/files")
  assert.equal(url.searchParams.get("path"), path)
})

test("cleanupPreviewInput includes deduped projectPaths when specified and rejects over limit", () => {
  assert.deepEqual(
    cleanupPreviewInput({
      kinds: ["node_modules"],
      olderThanDays: "",
      minSizeMib: "",
      projectPaths: ["D:\\TEST\\a", "D:\\TEST\\a", "D:\\TEST\\b"],
    }),
    { includeKinds: ["node_modules"], projectPaths: ["D:\\TEST\\a", "D:\\TEST\\b"] },
  )
  assert.deepEqual(
    cleanupPreviewInput({ kinds: ["node_modules"], olderThanDays: "", minSizeMib: "", projectPaths: [] }),
    { includeKinds: ["node_modules"] },
  )
  const overLimit = Array.from({ length: 1001 }, (_, idx) => `D:\\TEST\\p-${idx}`)
  assert.equal(
    cleanupPreviewInput({ kinds: ["node_modules"], olderThanDays: "", minSizeMib: "", projectPaths: overLimit }),
    null,
  )
})

test("sortCleanupTargets supports risk, name, and explicit asc/desc directions", () => {
  const low = target("D:\\TEST\\z\\node_modules", {
    owner: { path: "D:\\TEST\\z", name: "zeta" },
    risk: { level: "low", reasons: [] },
    size: size({ reclaimableBytes: 100 }),
  })
  const high = target("D:\\TEST\\a\\node_modules", {
    owner: { path: "D:\\TEST\\a", name: "alpha" },
    risk: { level: "high", reasons: [] },
    size: size({ reclaimableBytes: 10 }),
  })
  const med = target("D:\\TEST\\m\\node_modules", {
    owner: { path: "D:\\TEST\\m", name: "mid" },
    risk: { level: "medium", reasons: [] },
    size: size({ reclaimableBytes: 50 }),
  })
  assert.deepEqual(sortCleanupTargets([low, high, med], "risk", "en").map((t) => t.path), [high.path, med.path, low.path])
  assert.deepEqual(sortCleanupTargets([low, high, med], "risk", "en", "asc").map((t) => t.path), [low.path, med.path, high.path])
  assert.deepEqual(sortCleanupTargets([low, high, med], "name", "en").map((t) => t.path), [high.path, med.path, low.path])
  assert.deepEqual(sortCleanupTargets([low, high, med], "name", "en", "desc").map((t) => t.path), [low.path, med.path, high.path])
  assert.deepEqual(sortCleanupTargets([low, high, med], "size", "en", "asc").map((t) => t.path), [high.path, med.path, low.path])
})

test("computeCleanupMetrics summarizes valid targets, kinds, risks, and selected totals", () => {
  const targets = [
    target("a", { kind: "node_modules", method: "permanent", size: size({ reclaimableBytes: 100 }), risk: { level: "low", reasons: [] } }),
    target("b", { kind: "build_cache", method: "permanent", size: size({ reclaimableBytes: 40 }), risk: { level: "medium", reasons: [] } }),
    target("c", { kind: "orphan_node_modules", method: "recycle", size: size({ reclaimableBytes: 60 }), risk: { level: "high", reasons: [] } }),
    target("d", { valid: false, size: size({ status: "failed", reclaimableBytes: null }) }),
  ]
  const metrics = computeCleanupMetrics(targets, new Set(["a", "c"]))
  assert.equal(metrics.totalTargets, 4)
  assert.equal(metrics.eligibleCount, 3)
  assert.equal(metrics.invalidCount, 1)
  assert.equal(metrics.totalReclaimableBytes, 200)
  assert.equal(metrics.maxTargetBytes, 100)
  assert.equal(metrics.attentionCount, 2)
  assert.equal(metrics.selected.count, 2)
  assert.equal(metrics.selected.reclaimableBytes, 100)
  assert.equal(metrics.selected.recycleBytes, 60)
  assert.equal(metrics.selectedHighestRisk, "high")
  assert.equal(metrics.byKind.node_modules.count, 1)
  assert.equal(metrics.byKind.build_cache.bytes, 40)
  assert.equal(metrics.byKind.orphan_node_modules.count, 1)
})

test("applyQuickSelection handles recommended, visible, low_risk_visible, deselect_visible, clear", () => {
  const targets = [
    target("vis-low", { defaultSelected: true, risk: { level: "low", reasons: [] } }),
    target("vis-high", { defaultSelected: false, risk: { level: "high", reasons: [] } }),
    target("vis-invalid", { valid: false, defaultSelected: true }),
    target("hid-low", { defaultSelected: true, risk: { level: "low", reasons: [] } }),
  ]
  const visible = new Set(["vis-low", "vis-high", "vis-invalid"])

  assert.deepEqual(
    [...applyQuickSelection(targets, visible, new Set(["vis-high"]), "recommended")].sort(),
    ["hid-low", "vis-low"],
  )
  assert.deepEqual(
    [...applyQuickSelection(targets, visible, new Set(["hid-low"]), "visible")].sort(),
    ["hid-low", "vis-high", "vis-low"],
  )
  assert.deepEqual(
    [...applyQuickSelection(targets, visible, new Set(["vis-high", "hid-low"]), "low_risk_visible")].sort(),
    ["vis-low"],
  )
  assert.deepEqual(
    [...applyQuickSelection(targets, visible, new Set(["vis-low", "vis-high", "hid-low"]), "deselect_visible")],
    ["hid-low"],
  )
  assert.deepEqual(
    [...applyQuickSelection(targets, visible, new Set(["vis-low", "hid-low"]), "clear")],
    [],
  )
})

test("applyRangeSelection toggles contiguous eligible range forward and backward", () => {
  const ordered = ["p1", "p2", "p3", "p4", "p5"]
  const eligible = new Set(["p1", "p2", "p4", "p5"])
  const forward = applyRangeSelection(ordered, eligible, new Set(["p1"]), "p1", "p4")
  assert.deepEqual([...forward].sort(), ["p1", "p2", "p4"])
  const backward = applyRangeSelection(ordered, eligible, new Set(["p4"]), "p4", "p2")
  assert.deepEqual([...backward].sort(), ["p2", "p4"])
  // Deselecting range when target is already selected
  const deselect = applyRangeSelection(ordered, eligible, new Set(["p1", "p2", "p4", "p5"]), "p2", "p4")
  assert.deepEqual([...deselect].sort(), ["p1", "p5"])
})

test("groupTargetsByOwner groups by owner path and puts ownerless items in orphan group", () => {
  const targets = [
    target("D:\\TEST\\app-a\\node_modules", { owner: { path: "D:\\TEST\\app-a", name: "app-a" }, size: size({ reclaimableBytes: 50 }) }),
    target("D:\\TEST\\app-a\\.next", { kind: "build_cache", owner: { path: "D:\\TEST\\app-a", name: "app-a" }, size: size({ reclaimableBytes: 30 }) }),
    target("D:\\TEST\\app-b\\node_modules", { owner: { path: "D:\\TEST\\app-b", name: "app-b" }, size: size({ reclaimableBytes: 120 }) }),
    target("D:\\TEST\\stray\\node_modules", { kind: "orphan_node_modules", owner: null, size: size({ reclaimableBytes: 20 }) }),
  ]
  const groups = groupTargetsByOwner(targets, "en")
  assert.equal(groups.length, 3)
  assert.equal(groups[0].ownerName, "app-b")
  assert.equal(groups[0].totalReclaimableBytes, 120)
  assert.equal(groups[1].ownerName, "app-a")
  assert.equal(groups[1].targets.length, 2)
  assert.equal(groups[1].totalReclaimableBytes, 80)
  assert.equal(groups[2].isOrphanGroup, true)
  assert.equal(groups[2].targets.length, 1)
})

test("formatRelativeDays computes non-negative day deltas deterministically", () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z")
  assert.equal(formatRelativeDays("2026-11-20T10:00:00.000Z", now), 0)
  assert.equal(formatRelativeDays("2026-11-10T12:00:00.000Z", now), 10)
  assert.equal(formatRelativeDays("2026-11-25T12:00:00.000Z", now), 0)
  assert.equal(formatRelativeDays(null, now), null)
  assert.equal(formatRelativeDays("not-a-date", now), null)
})
