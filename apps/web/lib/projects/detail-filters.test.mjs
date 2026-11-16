import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_DEPENDENCY_FILTERS, DEFAULT_ADVISORY_FILTERS, DEFAULT_SCRIPT_FILTERS,
  createDependencyStatusReader, selectDependencies, selectAdvisories, selectScripts,
} from "./detail-filters.ts"

const section = (items = [], overrides = {}) => ({
  state: "complete", items, warningCodes: [], failureCode: null,
  checkedCount: items.length, totalCount: items.length, ...overrides,
})
const analysis = (outdated = [], audit = [], overrides = {}) => ({
  jobId: "TEST-job", status: "completed", path: "D:/TEST", requestPath: "D:/TEST", scanId: "TEST-scan",
  inputHash: "TEST-hash", phase: "done", partial: false, stale: false,
  startedAt: "2026-11-16T00:00:00Z", finishedAt: "2026-11-16T00:00:01Z", checkedAt: "2026-11-16T00:00:01Z",
  outdated: section(outdated), audit: section(audit), warningCodes: [], failureCode: null, ...overrides,
})
const dependency = (name = "TEST-Package", declarations = [
  { group: "dependencies", spec: "^1", lockedVersions: ["1.0.0"] },
]) => ({ name, declarations, lockedVersions: [...new Set(declarations.flatMap(row => row.lockedVersions ?? []))] })
const result = (name = "TEST-Package", overrides = {}) => ({
  name, registryName: name, declaredSpec: "^1", lockedVersions: ["1.0.0"], wanted: "1.2.0", latest: "2.0.0",
  behindWanted: true, behindLatest: true, warning: null, ...overrides,
})
const advisory = (overrides = {}) => ({
  id: "TEST-advisory", name: "TEST-Package", title: "TEST unsafe input", url: null,
  severity: "high", range: "<1.1.0", affectedVersions: ["1.0.0"], direct: true, ...overrides,
})
const depSelect = (items, job = null, query = "", filters = DEFAULT_DEPENDENCY_FILTERS, sort = "name", locale = "en") =>
  selectDependencies(items, job, query, sort, locale, filters)

test("dependency search covers case-insensitive name, declarations and known local or analyzed versions", () => {
  const item = dependency()
  const job = analysis([result()])
  for (const query of [" package ", "^1", "1.0.0", " 1.2.0 ", "2.0.0"]) {
    assert.deepEqual(depSelect([item], job, query), [item])
  }
  assert.deepEqual(depSelect([item], null, "2.0.0"), [])
  assert.deepEqual(depSelect([item], job, "TEST-no-match"), [])
})

test("group and status intersect at package level while preserving every declaration and lock row exactly once", () => {
  const item = dependency("TEST-Mixed", [
    { group: "dependencies", spec: "^1", lockedVersions: ["1.0.0"] },
    { group: "devDependencies", spec: "^2", lockedVersions: ["2.0.0"] },
    { group: "optionalDependencies", spec: "^1", lockedVersions: ["1.0.0"] },
  ])
  const other = dependency("TEST-Other")
  const job = analysis([result(item.name)])
  const selected = depSelect([item, other], job, "^2", { groups: ["devDependencies"], statuses: ["outdated"] })
  assert.deepEqual(selected, [item])
  assert.equal(selected[0], item)
  assert.equal(selected[0].declarations.length, 3)
  assert.deepEqual(selected[0].lockedVersions, ["1.0.0", "2.0.0"])
  assert.deepEqual(depSelect([item, other], job, "", { groups: ["peerDependencies"], statuses: [] }), [])
})

test("vulnerable status finds registry aliases without treating another alias as a transitive match", () => {
  const alias = dependency("TEST-Alias")
  const unrelated = dependency("TEST-Other")
  const job = analysis([
    result(alias.name, { registryName: "TEST-real" }),
    result(unrelated.name, { registryName: alias.name }),
  ], [advisory({ name: "TEST-real" })])
  assert.deepEqual(depSelect([alias, unrelated], job, "", { groups: [], statuses: ["vulnerable"] }), [alias])
})

test("unchecked never means clean for missing, incomplete, failed, stale or unmatched analysis", () => {
  const item = dependency()
  const complete = analysis([result(item.name, { behindWanted: false, behindLatest: false })])
  assert.deepEqual(createDependencyStatusReader(complete)(item), { outdated: false, vulnerable: false, unchecked: false })
  for (const job of [null, analysis(),
    { ...complete, stale: true }, { ...complete, partial: true }, { ...complete, checkedAt: null },
    ...["running", "failed", "cancelled", "timed_out"].map(status => ({ ...complete, status })),
    ...["pending", "running", "partial", "unavailable"].map(state => ({ ...complete, audit: section([], { state }) })),
    { ...complete, audit: section([], { failureCode: "REGISTRY_UNAVAILABLE" }) },
    analysis([result(item.name, { behindWanted: null, behindLatest: null })]),
  ]) {
    assert.deepEqual(depSelect([item], job, "", { groups: [], statuses: ["unchecked"] }), [item])
    assert.equal(createDependencyStatusReader(job)(item).unchecked, true)
  }
  assert.deepEqual(depSelect([item], complete, "", { groups: [], statuses: ["unchecked"] }), [])
})

test("partial and stale findings remain discoverable while also remaining unchecked", () => {
  const item = dependency()
  const job = analysis([result()], [advisory()], { stale: true, partial: true })
  assert.deepEqual(createDependencyStatusReader(job)(item), { outdated: true, vulnerable: true, unchecked: true })
  for (const status of ["outdated", "vulnerable", "unchecked"]) {
    assert.deepEqual(depSelect([item], job, "", { groups: [], statuses: [status] }), [item])
  }
})

test("unknown or incomplete coverage totals never turn absence of findings into a checked status", () => {
  const item = dependency()
  const job = analysis([result(item.name, { behindWanted: false, behindLatest: false })])
  for (const audit of [section([], { totalCount: null }), section([], { checkedCount: 1, totalCount: 2 })]) {
    assert.equal(createDependencyStatusReader({ ...job, audit })(item).unchecked, true)
  }
})

test("a multi-spec dependency cannot borrow an ambiguous name-only analysis row", () => {
  const item = dependency("TEST-Mixed", [
    { group: "dependencies", spec: "^1", lockedVersions: ["1.0.0"] },
    { group: "devDependencies", spec: "^2", lockedVersions: ["2.0.0"] },
  ])
  const job = analysis([result(item.name, { declaredSpec: undefined })])
  assert.equal(createDependencyStatusReader(job)(item).unchecked, true)
  assert.deepEqual(depSelect([item], job, "1.2.0"), [])
})

test("dependency status sort prioritizes vulnerability, outdated, unchecked, then checked and uses locale name ties", () => {
  const current = dependency("TEST-current")
  const unchecked = dependency("TEST-unchecked")
  const outdated = dependency("TEST-outdated")
  const vulnerable = dependency("TEST-vulnerable")
  const job = analysis([
    result(current.name, { behindWanted: false, behindLatest: false }), result(outdated.name), result(vulnerable.name),
  ], [advisory({ name: vulnerable.name })])
  assert.deepEqual(depSelect([current, unchecked, outdated, vulnerable], job, "", DEFAULT_DEPENDENCY_FILTERS, "status"),
    [vulnerable, outdated, unchecked, current])
  const a = dependency("ä"), z = dependency("z")
  assert.deepEqual(depSelect([z, a], null, "", DEFAULT_DEPENDENCY_FILTERS, "name", "en"), [a, z])
  assert.deepEqual(depSelect([a, z], null, "", DEFAULT_DEPENDENCY_FILTERS, "name", "sv"), [z, a])
})

test("empty dependency inputs and reset defaults preserve input objects and stable ties", () => {
  const first = dependency(), second = dependency()
  const input = Object.freeze([first, second])
  const before = structuredClone(input)
  assert.deepEqual(depSelect([], null), [])
  assert.deepEqual(depSelect(input, null, "\t\n"), input)
  assert.deepEqual(depSelect(input, null, "", DEFAULT_DEPENDENCY_FILTERS), [first, second])
  assert.equal(depSelect(input)[0], first)
  assert.notEqual(depSelect(input), input)
  assert.deepEqual(input, before)
})

test("advisory query, unknown severity and directness intersect using actual advisory fields", () => {
  const direct = advisory({ severity: "unknown" })
  const transitive = advisory({ id: "TEST-transitive", direct: false, severity: "unknown" })
  const known = advisory({ id: "TEST-known" })
  const rows = [direct, transitive, known]
  for (const query of [" package ", "UNSAFE INPUT", "<1.1.0"]) {
    assert.deepEqual(selectAdvisories(rows, query, "severity", "en", { severities: ["unknown"], exposures: ["transitive"] }), [transitive])
  }
  assert.deepEqual(selectAdvisories(rows, "", "name", "en", { severities: ["high"], exposures: ["direct"] }), [known])
  assert.deepEqual(selectAdvisories(rows, "missing", "name", "en"), [])
})

test("advisory search includes the advisory identifier and affected version evidence", () => {
  const item = advisory({ id: "TEST-CVE-2026", affectedVersions: ["1.0.7"] })
  for (const query of [" cve-2026 ", "1.0.7"]) {
    assert.deepEqual(selectAdvisories([item], query, "severity", "en"), [item])
  }
})

test("advisory sorts use all severity levels, supplied locale and deterministic name/id ties", () => {
  const rows = ["unknown", "info", "low", "moderate", "high", "critical"].map(severity => advisory({ severity, id: `TEST-${severity}` }))
  assert.deepEqual(selectAdvisories(rows, "", "severity", "en").map(row => row.severity),
    ["critical", "high", "moderate", "low", "info", "unknown"])
  const a = advisory({ name: "ä", id: "TEST-a" }), z = advisory({ name: "z", id: "TEST-z" })
  assert.deepEqual(selectAdvisories([z, a], "", "name", "en"), [a, z])
  assert.deepEqual(selectAdvisories([a, z], "", "name", "sv"), [z, a])
  const second = advisory({ id: "TEST-2" }), first = advisory({ id: "TEST-1" })
  assert.deepEqual(selectAdvisories([second, first], "", "severity", "en"), [first, second])
  const duplicate = { ...first }
  assert.equal(selectAdvisories([first, duplicate], "", "name", "en")[0], first)
})

test("advisory reset and empty input retain original data without mutation", () => {
  const item = Object.freeze(advisory()), input = Object.freeze([item])
  assert.deepEqual(selectAdvisories([], "", "severity", "en"), [])
  assert.deepEqual(selectAdvisories(input, " \n ", "severity", "en", DEFAULT_ADVISORY_FILTERS), [item])
  assert.equal(selectAdvisories(input, "", "name", "en")[0], item)
  assert.deepEqual(input, [item])
})

test("script search matches name or command, respects locale and preserves stable ties", () => {
  const build = Object.freeze({ name: "build", command: "TEST Compile --watch" })
  const testScript = Object.freeze({ name: "test", command: "TEST Run" })
  const input = Object.freeze([testScript, build])
  assert.deepEqual(selectScripts(input, " BUILD ", "en"), [build])
  assert.deepEqual(selectScripts(input, "compile --WATCH", "en"), [build])
  assert.deepEqual(selectScripts(input, " ", "en"), [build, testScript])
  assert.deepEqual(selectScripts(input, "missing", "en"), [])
  const a = { name: "ä", command: "TEST" }, z = { name: "z", command: "TEST" }
  assert.deepEqual(selectScripts([a, z], "", "sv"), [z, a])
  const tied = { ...build }
  assert.equal(selectScripts([build, tied], "", "en")[0], build)
  assert.deepEqual(input, [testScript, build])
})

test("script eligibility is used only with an actual context and matching name/command evidence", () => {
  const eligible = { name: "build", command: "TEST build" }
  const ineligible = { name: "bad script", command: "TEST bad" }
  const changed = { name: "changed", command: "TEST new" }
  const unknown = { name: "unknown", command: "TEST unknown" }
  const input = [eligible, ineligible, changed, unknown]
  const context = { requestPath: "D:/TEST", path: "D:/TEST", scanId: "TEST", inputHash: "TEST", manager: "npm",
    version: null, available: true, reason: null, warnings: [], scripts: [
      { ...eligible, eligible: true }, { ...ineligible, eligible: false },
      { name: changed.name, command: "TEST old", eligible: true },
    ] }
  assert.deepEqual(selectScripts(input, "", "en", { eligibilities: ["eligible"] }, context), [eligible])
  assert.deepEqual(selectScripts(input, "", "en", { eligibilities: ["ineligible"] }, context), [ineligible])
  for (const eligibility of ["eligible", "ineligible"]) {
    assert.deepEqual(selectScripts(input, "", "en", { eligibilities: [eligibility] }), [])
  }
  assert.deepEqual(selectScripts(input, "", "en", DEFAULT_SCRIPT_FILTERS), [ineligible, eligible, changed, unknown])
  assert.deepEqual(selectScripts([], "", "en"), [])
})

test("multiple dependency values OR within each group and AND across groups and query", () => {
  const regular = dependency("TEST-regular")
  const dev = dependency("TEST-dev", [{ group: "devDependencies", spec: "^1", lockedVersions: [] }])
  const peer = dependency("TEST-peer", [{ group: "peerDependencies", spec: "^1", lockedVersions: [] }])
  const job = analysis([result(regular.name), result(dev.name, { behindWanted: false, behindLatest: false }), result(peer.name)])
  const filters = Object.freeze({ groups: Object.freeze(["dependencies", "devDependencies"]),
    statuses: Object.freeze(["outdated", "vulnerable"]) })
  assert.deepEqual(depSelect([peer, dev, regular], job, "TEST", filters), [regular])
  assert.deepEqual(depSelect([peer, dev, regular], job, "peer", filters), [])
  assert.deepEqual(depSelect([regular, dev, peer], job, "", { groups: filters.groups, statuses: [] }), [dev, regular])
  assert.deepEqual(filters.statuses, ["outdated", "vulnerable"])
})

test("advisory multi-severity and multi-exposure selections OR within and AND across groups", () => {
  const high = advisory({ id: "TEST-high", severity: "high" })
  const unknown = advisory({ id: "TEST-unknown", severity: "unknown", direct: false })
  const low = advisory({ id: "TEST-low", severity: "low", direct: false })
  const input = [high, unknown, low]
  assert.deepEqual(selectAdvisories(input, "", "severity", "en", {
    severities: ["high", "unknown"], exposures: ["direct", "transitive"],
  }), [high, unknown])
  assert.deepEqual(selectAdvisories(input, "", "severity", "en", {
    severities: ["high", "unknown"], exposures: ["transitive"],
  }), [unknown])
})
