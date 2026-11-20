import { test } from "node:test"
import assert from "node:assert/strict"
import {
  computeDiskUsageMetrics,
  diskRowBarWidthPercent,
  diskRowSharePercent,
  selectTopHeaviestProjects,
} from "./disk-usage-metrics.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
function row(overrides = {}) {
  return {
    path: "D:\\TEST\\dir\\item",
    name: "item",
    kind: "directory",
    canonicalPath: "D:\\TEST\\dir\\item",
    aliases: [],
    state: "complete",
    sizeBytes: 100,
    fileCount: 5,
    reason: null,
    ...overrides,
  }
}

function job(overrides = {}) {
  return {
    jobId: "TEST-job-1",
    status: "completed",
    path: "D:\\TEST\\dir",
    view: "directory",
    metric: "unique-apparent",
    phase: "measuring",
    partial: false,
    stopReason: null,
    sizeBytes: 1000,
    fileCount: 50,
    children: [],
    progress: { visitedDirs: 5, visitedEntries: 50, skippedCount: 0, skippedLinks: 0 },
    startedAt: "2026-11-20T00:00:00.000Z",
    measuredAt: "2026-11-20T00:00:05.000Z",
    cacheHit: false,
    failureCode: null,
    ...overrides,
  }
}

function project(overrides = {}) {
  return {
    path: "D:\\TEST\\app",
    name: "TEST-app",
    packageManager: "pnpm",
    hasLockfile: true,
    lastActivityAt: "2026-11-19T00:00:00.000Z",
    nodeModules: {
      exists: true,
      path: "D:\\TEST\\app\\node_modules",
      sizeBytes: null,
      sizeMeasuredAt: null,
    },
    ...overrides,
  }
}

test("diskRowSharePercent handles null, zero total, rounding, and overlap clamp", () => {
  assert.equal(diskRowSharePercent(null, 1000), null)
  assert.equal(diskRowSharePercent(100, null), null)
  assert.equal(diskRowSharePercent(100, 0), null)
  assert.equal(diskRowSharePercent(0, 1000), 0)
  assert.equal(diskRowSharePercent(256, 1000), 25.6)
  assert.equal(diskRowSharePercent(1, 3), 33.3)
  assert.equal(diskRowSharePercent(1200, 1000), 100)
})

test("diskRowBarWidthPercent enforces minimum visible floor for non-zero rows and clamps at 100", () => {
  assert.equal(diskRowBarWidthPercent(null, 1000), 0)
  assert.equal(diskRowBarWidthPercent(0, 1000), 0)
  assert.equal(diskRowBarWidthPercent(100, 0), 0)
  assert.equal(diskRowBarWidthPercent(1, 10000), 4)
  assert.equal(diskRowBarWidthPercent(500, 1000), 50)
  assert.equal(diskRowBarWidthPercent(1500, 1000), 100)
})

test("computeDiskUsageMetrics summarizes total, top child, excluded, and partial counts", () => {
  const children = [
    row({ path: "D:\\TEST\\dir\\a", name: "a", sizeBytes: 200, state: "complete" }),
    row({ path: "D:\\TEST\\dir\\b", name: "b", sizeBytes: 600, state: "partial" }),
    row({ path: "D:\\TEST\\dir\\c", name: "c", sizeBytes: null, state: "excluded", reason: "protected" }),
  ]
  const metrics = computeDiskUsageMetrics(job({ sizeBytes: 1000, fileCount: 42, children }))
  assert.equal(metrics.totalBytes, 1000)
  assert.equal(metrics.totalFiles, 42)
  assert.equal(metrics.itemCount, 3)
  assert.equal(metrics.maxChildBytes, 600)
  assert.equal(metrics.excludedCount, 1)
  assert.equal(metrics.partialCount, 1)
  assert.deepEqual(metrics.topChild, {
    name: "b",
    path: "D:\\TEST\\dir\\b",
    sizeBytes: 600,
    sharePercent: 60,
  })
})

test("computeDiskUsageMetrics returns null topChild when no positive child sizes exist", () => {
  const metrics = computeDiskUsageMetrics(job({
    sizeBytes: 0,
    children: [row({ sizeBytes: 0 }), row({ sizeBytes: null, state: "pending" })],
  }))
  assert.equal(metrics.topChild, null)
  assert.equal(metrics.maxChildBytes, 0)
})

test("selectTopHeaviestProjects prioritizes measured node_modules desc then unmeasured existing node_modules", () => {
  const small = project({
    path: "D:\\TEST\\small",
    name: "TEST-small",
    nodeModules: { exists: true, path: "D:\\TEST\\small\\node_modules", sizeBytes: 100, sizeMeasuredAt: "2026-11-20T00:00:00.000Z" },
  })
  const huge = project({
    path: "D:\\TEST\\huge",
    name: "TEST-huge",
    nodeModules: { exists: true, path: "D:\\TEST\\huge\\node_modules", sizeBytes: 5000, sizeMeasuredAt: "2026-11-20T00:00:00.000Z" },
  })
  const unmeasuredNew = project({
    path: "D:\\TEST\\unmeasured-new",
    name: "TEST-unmeasured-new",
    lastActivityAt: "2026-11-20T00:00:00.000Z",
    nodeModules: { exists: true, path: "D:\\TEST\\unmeasured-new\\node_modules", sizeBytes: null, sizeMeasuredAt: null },
  })
  const noNm = project({
    path: "D:\\TEST\\no-nm",
    name: "TEST-no-nm",
    nodeModules: { exists: false, path: "D:\\TEST\\no-nm\\node_modules", sizeBytes: null, sizeMeasuredAt: null },
  })
  const picked = selectTopHeaviestProjects([noNm, small, unmeasuredNew, huge], 3)
  assert.deepEqual(picked.map((item) => item.name), ["TEST-huge", "TEST-small", "TEST-unmeasured-new"])
})
