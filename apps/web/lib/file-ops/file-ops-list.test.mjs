import { test } from "node:test"
import assert from "node:assert/strict"
import {
  cleanupPreviewInput, fileManagerHref, fileOpsErrorKey, initialReviewSelection, isReviewTarget, operationCounts,
  resultErrorKey, reviewTotals, sortCleanupTargets, sortOperationResults, targetFailureKey,
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
