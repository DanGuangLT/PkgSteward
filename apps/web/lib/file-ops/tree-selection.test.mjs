import { test } from "node:test"
import assert from "node:assert/strict"
import { MAX_DELETE_PATHS, isInsidePath, toggleTreePath, treeCheckState } from "./tree-selection.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const entry = (path, overrides = {}) => ({
  name: path.split("\\").at(-1), path, type: "directory", sizeBytes: null, selectable: true, ...overrides,
})
const root = "D:\\TEST"
const src = `${root}\\src`
const lib = `${src}\\lib`
const a = `${lib}\\a.ts`
const b = `${lib}\\b.ts`
const main = `${src}\\main.ts`
const link = `${src}\\link`
const docs = `${root}\\docs`
const levels = new Map([
  [src, [entry(lib), entry(main, { type: "file" }), entry(link, { type: "link", selectable: false })]],
  [lib, [entry(a, { type: "file" }), entry(b, { type: "file" })]],
])
const childrenOf = (path) => levels.get(path)
const toggle = (selected, target, options) => toggleTreePath(new Set(selected), entry(target, options), childrenOf)

test("isInsidePath needs a separator boundary and either separator", () => {
  assert.equal(isInsidePath("D:\\a", "D:\\a\\b"), true)
  assert.equal(isInsidePath("D:\\a", "D:\\a/b"), true)
  assert.equal(isInsidePath("/a", "/a/b"), true)
  assert.equal(isInsidePath("D:\\a", "D:\\ab"), false)
  assert.equal(isInsidePath("D:\\a", "D:\\a"), false)
  assert.equal(isInsidePath("D:\\a\\b", "D:\\a"), false)
})

test("selecting a folder covers its whole subtree including unloaded levels", () => {
  const selected = toggle([], src)
  assert.deepEqual([...selected], [src])
  assert.equal(treeCheckState(selected, src), "checked")
  assert.equal(treeCheckState(selected, a), "checked")
  assert.equal(treeCheckState(selected, `${src}\\unloaded\\deep\\file`), "checked")
  assert.equal(treeCheckState(selected, docs), "unchecked")
})

test("selected children make every ancestor indeterminate, siblings stay unchecked", () => {
  const selected = toggle([], a)
  assert.equal(treeCheckState(selected, a), "checked")
  assert.equal(treeCheckState(selected, lib), "indeterminate")
  assert.equal(treeCheckState(selected, src), "indeterminate")
  assert.equal(treeCheckState(selected, b), "unchecked")
  assert.equal(treeCheckState(selected, docs), "unchecked")
})

test("a sibling sharing a name prefix is not a descendant", () => {
  const selected = toggle([], `${root}\\src2`)
  assert.equal(treeCheckState(selected, src), "unchecked")
  assert.equal(treeCheckState(toggle([], src), `${root}\\src2`), "unchecked")
})

test("all children selected one by one keep the folder itself indeterminate", () => {
  const selected = toggle(toggle([], a), b)
  assert.deepEqual([...selected].sort(), [a, b])
  assert.equal(treeCheckState(selected, lib), "indeterminate")
})

test("selecting an indeterminate folder replaces its selected descendants", () => {
  assert.deepEqual([...toggle([a], src)], [src])
})

test("deselecting a selected path removes only that path", () => {
  assert.deepEqual([...toggle([src, docs], src)], [docs])
  assert.deepEqual([...toggle([a, b], a)], [b])
})

test("deselecting a child deselects the folder and keeps loaded selectable siblings", () => {
  const selected = toggle([src], main)
  assert.deepEqual([...selected].sort(), [lib].sort())
  assert.equal(treeCheckState(selected, src), "indeterminate")
  assert.equal(treeCheckState(selected, main), "unchecked")
  assert.equal(treeCheckState(selected, lib), "checked")
})

test("deselecting a deep child walks each level and never adds the route or the link", () => {
  const selected = toggle([src], a)
  assert.deepEqual([...selected].sort(), [b, main].sort())
  assert.equal(selected.has(src), false)
  assert.equal(selected.has(lib), false)
  assert.equal(selected.has(link), false)
  assert.equal(treeCheckState(selected, src), "indeterminate")
  assert.equal(treeCheckState(selected, lib), "indeterminate")
})

test("deselecting never adds anything outside the deselected folder", () => {
  const selected = toggle([src, docs], a)
  assert.deepEqual([...selected].sort(), [b, docs, main].sort())
})

test("missing loaded level loses siblings instead of guessing them", () => {
  const unloaded = `${root}\\other\\x`
  assert.deepEqual([...toggleTreePath(new Set([`${root}\\other`]), entry(unloaded), childrenOf)], [])
})

test("unselectable entries never change the selection", () => {
  assert.deepEqual([...toggle([], link, { selectable: false })], [])
  assert.deepEqual([...toggle([src], link, { selectable: false })], [src])
})

test("toggle never mutates its input", () => {
  const selected = new Set([src])
  toggleTreePath(selected, entry(a), childrenOf)
  assert.deepEqual([...selected], [src])
})

test("selection limit matches the backend path limit", () => {
  assert.equal(MAX_DELETE_PATHS, 1000)
})
