import { test } from "node:test"
import assert from "node:assert/strict"
import { projectDisplayName, selectProjects } from "./project-list.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
function project(overrides = {}) {
  return {
    path: "D:\\TEST\\project",
    name: "TEST-project",
    packageManager: null,
    hasLockfile: false,
    lastActivityAt: "2026-10-20T00:00:00.000Z",
    nodeModules: { exists: false, path: "D:\\TEST\\project\\node_modules", sizeBytes: null },
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
