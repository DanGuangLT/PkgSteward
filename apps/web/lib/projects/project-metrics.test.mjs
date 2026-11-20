import { test } from "node:test"
import assert from "node:assert/strict"
import {
  analysisProgressPercent,
  computeProjectDetailMetrics,
  computeProjectListMetrics,
  filterProjectsByQuickView,
} from "./project-metrics.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const NOW = Date.parse("2026-11-20T00:00:00.000Z")
const DAY_MS = 86_400_000

function project(overrides = {}) {
  return {
    path: "D:\\TEST\\app",
    name: "TEST-app",
    packageManager: "pnpm",
    hasLockfile: true,
    lastActivityAt: new Date(NOW - 5 * DAY_MS).toISOString(),
    nodeModules: {
      exists: false,
      path: "D:\\TEST\\app\\node_modules",
      sizeBytes: null,
      sizeMeasuredAt: null,
    },
    ...overrides,
  }
}

test("computeProjectListMetrics summarizes projects, node_modules size, orphans, missing lockfile, and stale >30d", () => {
  const projects = [
    project({
      path: "D:\\TEST\\a",
      hasLockfile: true,
      lastActivityAt: new Date(NOW - 3 * DAY_MS).toISOString(),
      nodeModules: { exists: true, path: "D:\\TEST\\a\\node_modules", sizeBytes: 200, sizeMeasuredAt: "2026-11-19T00:00:00.000Z" },
    }),
    project({
      path: "D:\\TEST\\b",
      hasLockfile: false,
      lastActivityAt: new Date(NOW - 45 * DAY_MS).toISOString(),
      nodeModules: { exists: true, path: "D:\\TEST\\b\\node_modules", sizeBytes: 800, sizeMeasuredAt: "2026-11-19T00:00:00.000Z" },
    }),
    project({
      path: "D:\\TEST\\c",
      hasLockfile: false,
      lastActivityAt: "TEST-invalid-date",
      nodeModules: { exists: true, path: "D:\\TEST\\c\\node_modules", sizeBytes: null, sizeMeasuredAt: null },
    }),
    project({
      path: "D:\\TEST\\d",
      hasLockfile: true,
      lastActivityAt: new Date(NOW - 30 * DAY_MS).toISOString(),
      nodeModules: { exists: false, path: "D:\\TEST\\d\\node_modules", sizeBytes: null, sizeMeasuredAt: null },
    }),
  ]

  const metrics = computeProjectListMetrics(projects, 2, NOW)
  assert.deepEqual(metrics, {
    totalProjects: 4,
    withNodeModulesCount: 3,
    measuredNodeModulesCount: 2,
    knownNodeModulesBytes: 1000,
    maxNodeModulesBytes: 800,
    orphanCount: 2,
    missingLockfileCount: 2,
    inactiveOver30dCount: 1,
    // Project b is both missing lockfile AND inactive >30d: counted once in attentionCount, not twice.
    attentionCount: 2,
  })
})

test("filterProjectsByQuickView filters cleanly across all four quick views", () => {
  const freshWithNm = project({
    path: "D:\\TEST\\fresh-nm",
    hasLockfile: true,
    lastActivityAt: new Date(NOW - 2 * DAY_MS).toISOString(),
    nodeModules: { exists: true, path: "D:\\TEST\\fresh-nm\\node_modules", sizeBytes: 100, sizeMeasuredAt: null },
  })
  const staleNoLock = project({
    path: "D:\\TEST\\stale-nolock",
    hasLockfile: false,
    lastActivityAt: new Date(NOW - 40 * DAY_MS).toISOString(),
    nodeModules: { exists: false, path: "D:\\TEST\\stale-nolock\\node_modules", sizeBytes: null, sizeMeasuredAt: null },
  })
  const all = [freshWithNm, staleNoLock]
  assert.equal(filterProjectsByQuickView(all, "all", NOW).length, 2)
  assert.deepEqual(filterProjectsByQuickView(all, "has_node_modules", NOW), [freshWithNm])
  assert.deepEqual(filterProjectsByQuickView(all, "missing_lockfile", NOW), [staleNoLock])
  assert.deepEqual(filterProjectsByQuickView(all, "inactive_30d", NOW), [staleNoLock])
})

test("computeProjectDetailMetrics summarizes dependencies, scripts, outdated, and advisory counts", () => {
  const detail = {
    path: "D:\\TEST\\p",
    requestPath: "D:\\TEST\\p",
    name: "TEST-p",
    version: "1.0.0",
    manager: "pnpm",
    packageManager: "pnpm@11.0.0",
    lockfile: "pnpm-lock.yaml",
    scanId: "s1",
    inputHash: "h1",
    readAt: "2026-11-20T00:00:00.000Z",
    dependencies: [{ name: "a", declarations: [], lockedVersions: ["1.0.0"] }, { name: "b", declarations: [], lockedVersions: ["2.0.0"] }],
    scripts: [{ name: "dev", command: "next dev" }, { name: "build", command: "next build" }, { name: "test", command: "node --test" }],
    warnings: [],
    diskUsage: null,
  }

  assert.deepEqual(computeProjectDetailMetrics(detail, null), {
    dependencyCount: 2,
    scriptCount: 3,
    outdatedCount: null,
    advisoryCount: null,
    criticalOrHighAdvisoryCount: 0,
  })

  const job = {
    jobId: "j1",
    status: "completed",
    path: detail.path,
    requestPath: detail.requestPath,
    scanId: "s1",
    inputHash: "h1",
    phase: "done",
    partial: false,
    stale: false,
    startedAt: "2026-11-20T00:00:00.000Z",
    finishedAt: "2026-11-20T00:00:10.000Z",
    checkedAt: "2026-11-20T00:00:10.000Z",
    outdated: {
      state: "complete",
      items: [
        { name: "a", registryName: "a", lockedVersions: ["1.0.0"], wanted: "1.1.0", latest: "2.0.0", behindWanted: true, behindLatest: true, warning: null },
        { name: "b", registryName: "b", lockedVersions: ["2.0.0"], wanted: "2.0.0", latest: "2.0.0", behindWanted: false, behindLatest: false, warning: null },
      ],
      warningCodes: [],
      failureCode: null,
      checkedCount: 2,
      totalCount: 2,
    },
    audit: {
      state: "complete",
      items: [
        { id: "adv-1", name: "a", title: "Critical issue", url: null, severity: "critical", range: "<2.0.0", affectedVersions: ["1.0.0"], direct: true },
        { id: "adv-2", name: "b", title: "Low issue", url: null, severity: "low", range: "<3.0.0", affectedVersions: ["2.0.0"], direct: false },
      ],
      warningCodes: [],
      failureCode: null,
      checkedCount: 2,
      totalCount: 2,
    },
    warningCodes: [],
    failureCode: null,
  }

  assert.deepEqual(computeProjectDetailMetrics(detail, job), {
    dependencyCount: 2,
    scriptCount: 3,
    outdatedCount: 1,
    advisoryCount: 2,
    criticalOrHighAdvisoryCount: 1,
  })
})

test("analysisProgressPercent maps running phases to bounded percentages and returns null when idle", () => {
  const base = {
    status: "running",
    phase: "reading",
    outdated: { checkedCount: 0, totalCount: null },
  }
  assert.equal(analysisProgressPercent(null), null)
  assert.equal(analysisProgressPercent({ ...base, status: "completed" }), null)
  assert.equal(analysisProgressPercent({ ...base, phase: "reading" }), 15)
  assert.equal(analysisProgressPercent({ ...base, phase: "outdated", outdated: { checkedCount: 5, totalCount: 10 } }), 43)
  assert.equal(analysisProgressPercent({ ...base, phase: "audit" }), 80)
  assert.equal(analysisProgressPercent({ ...base, phase: "validating" }), 95)
})
