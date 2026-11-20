import assert from "node:assert/strict"
import { test } from "node:test"

import { getNavCurrent, navItems } from "../../components/layout/nav-items.ts"

function currentItems(pathname) {
  return navItems.flatMap(({ href }) => {
    const current = getNavCurrent(pathname, href)
    return current ? [[href, current]] : []
  })
}

test("marks the Projects list as the current page", () => {
  assert.deepEqual(currentItems("/"), [["/", "page"]])
})

test("marks Projects as the current section on its detail routes", () => {
  assert.deepEqual(currentItems("/projects"), [["/", "true"]])
  assert.deepEqual(currentItems("/projects/details"), [["/", "true"]])
})

test("marks only the matching section on unrelated routes", () => {
  assert.deepEqual(currentItems("/disk-usage"), [["/disk-usage", "page"]])
  assert.deepEqual(currentItems("/cleanup/result"), [["/cleanup", "true"]])
})

test("ignores routes with similar prefixes", () => {
  assert.deepEqual(currentItems("/projects-archive"), [])
  assert.deepEqual(currentItems("/cleanup-archive"), [])
})
