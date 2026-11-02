import { test } from "node:test"
import assert from "node:assert/strict"
import {
  projectDetailHref, projectValueKnown, projectSectionIsComplete, projectAuditIsClean,
  createProjectDependencyBadgeReader, sortProjectAdvisories, projectAnalysisStatusKey,
} from "./project-detail-list.ts"
import { initialAnalysisState, trackAnalysis, failAnalysisRequest, beginAnalysisCancel } from "./project-analysis-policy.ts"
import { ApiError } from "../api/response.ts"

// Dữ liệu TEST không phải yêu cầu nghiệp vụ.
const section = { state: "complete", items: [], warningCodes: [], failureCode: null, checkedCount: 0, totalCount: 0 }
const job = { jobId: "TEST-job", status: "completed", stale: false, partial: false, checkedAt: "TEST-time", audit: section, outdated: section }

test("detail href roundtrips reserved characters, Windows and Unicode", () => {
  const path = "D:\\TEST\\Thư mục #&+%?\\a"
  const url = new URL(projectDetailHref(path), "http://localhost")
  assert.equal(url.pathname, "/projects")
  assert.deepEqual([...url.searchParams], [["path", path]])
  assert.equal(url.hash, "")
})

test("nullable values preserve known zero, false and empty text", () => {
  assert.equal(projectValueKnown(null), false)
  for (const value of [0, false, "", "0", 42]) assert.equal(projectValueKnown(value), true)
})

test("clean audit requires current complete zero findings, never unknown or partial coverage", () => {
  assert.equal(projectAuditIsClean(null), false)
  assert.equal(projectAuditIsClean(job), true)
  for (const state of ["pending", "running", "partial", "unavailable"]) {
    assert.equal(projectSectionIsComplete({ ...section, state }), false)
    assert.equal(projectAuditIsClean({ ...job, audit: { ...section, state } }), false)
  }
  for (const patch of [{ stale: true }, { partial: true }, { status: "running" }, { status: "failed" }, { status: "cancelled" }, { status: "timed_out" }, { checkedAt: null }]) {
    assert.equal(projectAuditIsClean({ ...job, ...patch }), false)
  }
  assert.equal(projectAuditIsClean({ ...job, audit: { ...section, items: [{ id: "TEST" }] } }), false)
  assert.equal(projectAuditIsClean({ ...job, audit: { ...section, failureCode: "REGISTRY_UNAVAILABLE" } }), false)
  assert.equal(projectSectionIsComplete({ ...section, warningCodes: ["DEPRECATED_VERSION"] }), true)
  assert.equal(projectSectionIsComplete(null), false)
})

test("badges use available findings including partial/stale findings; unknown never means clean", () => {
  const snapshot = { ...job, stale: true, partial: true,
    outdated: { ...section, state: "partial", items: [
      { name: "TEST-alias", registryName: "TEST-real", behindWanted: null, behindLatest: true, warning: "DEPRECATED_VERSION" },
      { name: "TEST-tag", registryName: "TEST-tag", behindWanted: null, behindLatest: null },
      { name: "TEST-deprecated", registryName: "TEST-deprecated", behindWanted: false, behindLatest: false, warning: "DEPRECATED_VERSION" },
    ] },
    audit: { ...section, state: "partial", items: [{ name: "TEST-real" }, { name: "TEST-transitive" }] },
  }
  const badges = createProjectDependencyBadgeReader(snapshot)
  assert.deepEqual(badges("TEST-alias"), { outdated: true, vulnerable: true })
  assert.deepEqual(badges("TEST-transitive"), { outdated: false, vulnerable: true })
  for (const name of ["TEST-tag", "TEST-deprecated", "TEST-unchecked"]) {
    assert.deepEqual(badges(name), { outdated: false, vulnerable: false })
  }
  assert.deepEqual(createProjectDependencyBadgeReader(null)("TEST-alias"), { outdated: false, vulnerable: false })
})

test("badge reader indexes each snapshot once and does no per-name list traversal", () => {
  let outdatedReads = 0, auditReads = 0
  const snapshot = { ...job,
    outdated: { ...section, get items() { outdatedReads++; return [{ name: "TEST-alias", registryName: "TEST-real", behindWanted: true }] } },
    audit: { ...section, get items() { auditReads++; return [{ name: "TEST-real" }] } },
  }
  const badges = createProjectDependencyBadgeReader(snapshot)
  for (let i = 0; i < 2000; i++) assert.deepEqual(badges("TEST-alias"), { outdated: true, vulnerable: true })
  assert.equal(outdatedReads, 1)
  assert.equal(auditReads, 1)
})

test("severity sort is immutable and uses deterministic name/id ties", () => {
  const rows = [
    { id: "TEST-2", name: "TEST-a", severity: "high" }, { id: "TEST-unknown", name: "TEST-z", severity: "unknown" },
    { id: "TEST-1", name: "TEST-a", severity: "high" }, { id: "TEST-b", name: "TEST-b", severity: "high" },
    ...["info", "low", "moderate", "critical"].map(severity => ({ id: `TEST-${severity}`, name: "TEST", severity })),
  ]
  const frozen = Object.freeze(rows.map(Object.freeze))
  assert.deepEqual(sortProjectAdvisories(frozen).map(row => row.id), [
    "TEST-critical", "TEST-1", "TEST-2", "TEST-b", "TEST-moderate", "TEST-low", "TEST-info", "TEST-unknown",
  ])
  assert.equal(frozen[0].id, "TEST-2")
  assert.notEqual(sortProjectAdvisories(frozen), frozen)
})

test("status selector distinguishes starting, cancelling, untracked and lost", () => {
  const initial = initialAnalysisState()
  assert.equal(projectAnalysisStatusKey(initial), "status.idle")
  assert.equal(projectAnalysisStatusKey({ ...initial, phase: "starting" }), "status.starting")
  const tracking = trackAnalysis(initial, "TEST-job", "D:\\TEST")
  assert.equal(projectAnalysisStatusKey(tracking), "status.running")
  assert.equal(projectAnalysisStatusKey(beginAnalysisCancel(tracking)), "analysis.cancelling")
  const uncertain = failAnalysisRequest(beginAnalysisCancel(tracking), "cancel", new Error("TEST"))
  assert.equal(projectAnalysisStatusKey(uncertain), "analysis.cancelUnknown")
  assert.equal(projectAnalysisStatusKey(failAnalysisRequest(tracking, "poll", new ApiError(503, "TEST"))), "analysis.untracked")
  assert.equal(projectAnalysisStatusKey(failAnalysisRequest(tracking, "poll", new ApiError(404, "TEST"))), "status.lost")
  assert.equal(projectAnalysisStatusKey({ ...initial, job }), "status.completed")
  assert.equal(projectAnalysisStatusKey({ ...initial, job: { ...job, status: "running" } }), "analysis.untracked")
  assert.equal(projectAnalysisStatusKey({ ...initial, startUnknown: true }), "analysis.startUnknown")
})
