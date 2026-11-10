import { test } from "node:test"
import assert from "node:assert/strict"
import {
  countProjectFilters,
  DEFAULT_PROJECT_FILTERS,
  matchesProjectFilters,
  projectDisplayName,
  selectProjects,
} from "./project-list.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
function project(overrides = {}) {
  return {
    path: "D:\\TEST\\project",
    name: "TEST-project",
    packageManager: null,
    hasLockfile: false,
    lastActivityAt: "2026-10-20T00:00:00.000Z",
    nodeModules: { exists: false, path: "D:\\TEST\\project\\node_modules", sizeBytes: null, sizeMeasuredAt: null },
    ...overrides,
  }
}

test("null name uses Windows or forward-slash basename with trailing separators", () => {
  for (const path of ["D:\\TEST\\app", "D:\\TEST\\app\\", "D:\\TEST\\app\\\\", "/TEST/app", "/TEST/app///"]) {
    assert.equal(projectDisplayName(project({ name: null, path })), "app")
  }
})

test("non-null name is preserved including scoped names and empty strings", () => {
  for (const name of ["@TEST/scoped", "TEST-tên dự án", ""]) {
    assert.equal(projectDisplayName(project({ name })), name)
  }
})

test("empty and whitespace queries keep all projects", () => {
  const projects = [project(), project({ path: "D:\\TEST\\other" })]
  for (const query of ["", "   ", "\t\n"]) {
    assert.equal(selectProjects(projects, query, "activity", "vi").length, 2)
  }
})

test("name and path matching ignore case and trim the query", () => {
  const named = project({ name: "TEST-Widget" })
  const byPath = project({ path: "D:\\TEST\\Other", name: "TEST-other" })
  const projects = [named, byPath]
  assert.deepEqual(selectProjects(projects, " widget ", "name", "en"), [named])
  assert.deepEqual(selectProjects(projects, "d:\\test\\OTHER", "name", "en"), [byPath])
})

test("null-name projects can be found by their displayed basename", () => {
  const unnamed = project({ name: null, path: "/TEST/Fallback/" })
  assert.deepEqual(selectProjects([unnamed], "fallback", "name", "en"), [unnamed])
})

test("Vietnamese accents are preserved when matching", () => {
  const accented = project({ name: "TEST-dự án", path: "/TEST/accented" })
  assert.deepEqual(selectProjects([accented], "DỰ ÁN", "name", "vi"), [accented])
  assert.deepEqual(selectProjects([accented], "du an", "name", "vi"), [])
})

test("no matching name or path returns an empty list", () => {
  assert.deepEqual(selectProjects([project()], "TEST-no-match", "activity", "vi"), [])
})

test("activity sorts newest first by timestamp including timezone offsets", () => {
  const oldest = project({ path: "/TEST/old", lastActivityAt: "2026-10-19T12:00:00Z" })
  const newest = project({ path: "/TEST/new", lastActivityAt: "2026-10-20T08:00:00+07:00" })
  const middle = project({ path: "/TEST/mid", lastActivityAt: "2026-10-20T00:00:00Z" })
  assert.deepEqual(selectProjects([middle, oldest, newest], "", "activity", "vi"), [newest, middle, oldest])
})

test("name sorting uses the supplied locale and display-name fallback", () => {
  const a = project({ path: "/TEST/TEST-ä", name: null })
  const z = project({ path: "/TEST/z", name: "TEST-z" })
  assert.deepEqual(selectProjects([z, a], "", "name", "en"), [a, z])
  assert.deepEqual(selectProjects([a, z], "", "name", "sv"), [z, a])
})

test("equal names break ties by path regardless of input order", () => {
  const a = project({ path: "/TEST/a" })
  const z = project({ path: "/TEST/z" })
  assert.deepEqual(selectProjects([z, a], "", "name", "en"), [a, z])
  assert.deepEqual(selectProjects([a, z], "", "name", "en"), [a, z])
})

test("equal activity instants break ties by path", () => {
  const a = project({ path: "/TEST/a", lastActivityAt: "2026-10-20T07:00:00+07:00" })
  const z = project({ path: "/TEST/z", lastActivityAt: "2026-10-20T00:00:00Z" })
  assert.deepEqual(selectProjects([z, a], "", "activity", "en"), [a, z])
})

test("selection returns a new array without mutating input or project objects", () => {
  const a = Object.freeze(project({ path: "/TEST/a", name: "TEST-a" }))
  const z = Object.freeze(project({ path: "/TEST/z", name: "TEST-z" }))
  const projects = Object.freeze([z, a])
  for (const sort of ["name", "activity"]) {
    const result = selectProjects(projects, "TEST", sort, "en")
    assert.notEqual(result, projects)
    assert.deepEqual(result, [a, z])
    assert.deepEqual(projects, [z, a])
  }
})

const NOW = Date.parse("2026-11-10T00:00:00.000Z")
const DAY_MS = 86_400_000
const ALL_FILTERS = { manager: "all", nodeModules: "all", activity: "all" }

function activeProject(age, overrides = {}) {
  return project({ lastActivityAt: new Date(NOW - age).toISOString(), ...overrides })
}

test("default filters keep projects with unknown manager, missing modules and invalid activity", () => {
  const unknown = project({ lastActivityAt: "TEST-invalid-date" })
  assert.equal(matchesProjectFilters(unknown, DEFAULT_PROJECT_FILTERS, NOW), true)
  assert.deepEqual(selectProjects([unknown], "", "activity", "en"), [unknown])
})

for (const [manager, expected] of [
  ["all", ["npm", "pnpm", "yarn", null]],
  ["npm", ["npm"]],
  ["pnpm", ["pnpm"]],
  ["yarn", ["yarn"]],
  ["unknown", [null]],
]) {
  test(`manager filter ${manager} selects the matching package managers`, () => {
    const projects = ["npm", "pnpm", "yarn", null].map((packageManager, index) => project({
      path: `/TEST/${index}`, packageManager,
    }))
    const filters = { ...ALL_FILTERS, manager }
    assert.deepEqual(
      selectProjects(projects, "", "name", "en", filters, NOW).map((item) => item.packageManager),
      expected
    )
    assert.deepEqual(projects.filter((item) => matchesProjectFilters(item, filters, NOW)).map((item) => item.packageManager), expected)
  })
}

for (const [nodeModules, expected] of [["all", [false, true]], ["present", [true]], ["missing", [false]]]) {
  test(`node_modules filter ${nodeModules} selects by existence`, () => {
    const projects = [false, true].map((exists, index) => project({
      path: `/TEST/${index}`,
      nodeModules: { ...project().nodeModules, exists },
    }))
    assert.deepEqual(selectProjects(projects, "", "name", "en", { ...ALL_FILTERS, nodeModules }, NOW)
      .map((item) => item.nodeModules.exists), expected)
  })
}

for (const [activity, days] of [["within7d", 7], ["within30d", 30], ["within90d", 90]]) {
  test(`${activity} includes exactly ${days} days but excludes one millisecond older`, () => {
    const boundary = activeProject(days * DAY_MS, { path: "/TEST/boundary" })
    const older = activeProject(days * DAY_MS + 1, { path: "/TEST/older" })
    assert.deepEqual(selectProjects([older, boundary], "", "activity", "en", { ...ALL_FILTERS, activity }, NOW), [boundary])
  })
}

for (const [activity, days] of [["olderThan90d", 90], ["olderThan180d", 180], ["olderThan365d", 365]]) {
  test(`${activity} excludes exactly ${days} days but includes one millisecond older`, () => {
    const boundary = activeProject(days * DAY_MS, { path: "/TEST/boundary" })
    const older = activeProject(days * DAY_MS + 1, { path: "/TEST/older" })
    assert.deepEqual(selectProjects([boundary, older], "", "activity", "en", { ...ALL_FILTERS, activity }, NOW), [older])
  })
}

test("future activity matches every within range and no older-than range", () => {
  const future = activeProject(-DAY_MS)
  for (const activity of ["within7d", "within30d", "within90d"]) {
    assert.equal(matchesProjectFilters(future, { ...ALL_FILTERS, activity }, NOW), true)
  }
  for (const activity of ["olderThan90d", "olderThan180d", "olderThan365d"]) {
    assert.equal(matchesProjectFilters(future, { ...ALL_FILTERS, activity }, NOW), false)
  }
})

test("invalid activity matches all only", () => {
  const invalid = project({ lastActivityAt: "TEST-invalid-date" })
  assert.equal(matchesProjectFilters(invalid, ALL_FILTERS, NOW), true)
  for (const activity of ["within7d", "within30d", "within90d", "olderThan90d", "olderThan180d", "olderThan365d"]) {
    assert.deepEqual(selectProjects([invalid], "", "activity", "en", { ...ALL_FILTERS, activity }, NOW), [])
  }
})

test("all filters AND the search apply before the existing name or activity sort", () => {
  const filters = { manager: "npm", nodeModules: "present", activity: "within7d" }
  const recent = activeProject(DAY_MS, {
    path: "/TEST/recent", name: "TEST-Widget-Z", packageManager: "npm",
    nodeModules: { ...project().nodeModules, exists: true },
  })
  const earlier = { ...recent, path: "/TEST/earlier", name: "TEST-Widget-A", lastActivityAt: activeProject(2 * DAY_MS).lastActivityAt }
  const projects = Object.freeze([
    Object.freeze(earlier), Object.freeze(recent),
    { ...recent, path: "/TEST/manager", packageManager: "pnpm" },
    { ...recent, path: "/TEST/modules", nodeModules: project().nodeModules },
    { ...recent, path: "/TEST/old", lastActivityAt: activeProject(8 * DAY_MS).lastActivityAt },
    { ...recent, path: "/TEST/search", name: "TEST-unrelated" },
  ])
  assert.deepEqual(selectProjects(projects, " WIDGET ", "name", "en", filters, NOW), [earlier, recent])
  assert.deepEqual(selectProjects(projects, " WIDGET ", "activity", "en", filters, NOW), [recent, earlier])
  assert.deepEqual(selectProjects(projects, "/TEST/recent", "name", "en", filters, NOW), [recent])
})

test("option counts use the whole snapshot independently and include overlapping activity ranges", () => {
  const projects = [
    activeProject(0, { packageManager: "npm", nodeModules: { ...project().nodeModules, exists: true } }),
    activeProject(7 * DAY_MS, { packageManager: "pnpm" }),
    activeProject(30 * DAY_MS, { packageManager: "npm" }),
    activeProject(90 * DAY_MS, { packageManager: "yarn" }),
    activeProject(180 * DAY_MS, { packageManager: "yarn" }),
    activeProject(365 * DAY_MS, { nodeModules: { ...project().nodeModules, exists: true } }),
    activeProject(365 * DAY_MS + 1),
    activeProject(-DAY_MS, { packageManager: "npm" }),
    project({ lastActivityAt: "TEST-invalid-date" }),
  ]
  assert.deepEqual(countProjectFilters(projects, NOW), {
    manager: { all: 9, npm: 3, pnpm: 1, yarn: 2, unknown: 3 },
    nodeModules: { all: 9, present: 2, missing: 7 },
    activity: { all: 9, within7d: 3, within30d: 4, within90d: 5, olderThan90d: 3, olderThan180d: 2, olderThan365d: 1 },
  })
})

test("empty snapshots have zero counts for every option", () => {
  assert.deepEqual(countProjectFilters([], NOW), {
    manager: { all: 0, npm: 0, pnpm: 0, yarn: 0, unknown: 0 },
    nodeModules: { all: 0, present: 0, missing: 0 },
    activity: { all: 0, within7d: 0, within30d: 0, within90d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
  })
})
