import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildPageTokens,
  computePagination,
  normalizePageSize,
  PAGE_SIZE_OPTIONS,
  slicePage,
} from "./pagination.ts"

test("normalizePageSize accepts supported presets and falls back for unknown inputs", () => {
  assert.deepEqual(PAGE_SIZE_OPTIONS, [10, 25, 50, 100])
  for (const size of PAGE_SIZE_OPTIONS) {
    assert.equal(normalizePageSize(size), size)
  }
  assert.equal(normalizePageSize(0), 25)
  assert.equal(normalizePageSize(-10), 25)
  assert.equal(normalizePageSize(33), 25)
  assert.equal(normalizePageSize(Number.NaN, 10), 10)
  assert.equal(normalizePageSize(undefined, 50), 50)
})

test("computePagination handles empty lists, clamping, and exact boundary counts", () => {
  const empty = computePagination(0, 3, 25, true)
  assert.deepEqual(empty, {
    totalItems: 0,
    pageSize: 25,
    page: 1,
    totalPages: 1,
    startIndex: 0,
    endIndex: 0,
    showingFrom: 0,
    showingTo: 0,
    hasPrev: false,
    hasNext: false,
    enabled: true,
  })

  const clamped = computePagination(42, 9, 25, true)
  assert.equal(clamped.totalPages, 2)
  assert.equal(clamped.page, 2)
  assert.equal(clamped.startIndex, 25)
  assert.equal(clamped.endIndex, 42)
  assert.equal(clamped.showingFrom, 26)
  assert.equal(clamped.showingTo, 42)
  assert.equal(clamped.hasPrev, true)
  assert.equal(clamped.hasNext, false)

  const exact = computePagination(50, 1, 25, true)
  assert.equal(exact.totalPages, 2)
  assert.equal(exact.showingFrom, 1)
  assert.equal(exact.showingTo, 25)
  assert.equal(exact.hasPrev, false)
  assert.equal(exact.hasNext, true)

  const negativePage = computePagination(50, -4, 10, true)
  assert.equal(negativePage.page, 1)
  assert.equal(negativePage.endIndex, 10)
})

test("computePagination and slicePage return all items unchanged when disabled", () => {
  const source = Array.from({ length: 65 }, (_, index) => `item-${index + 1}`)
  const disabledMeta = computePagination(source.length, 3, 10, false)
  assert.equal(disabledMeta.enabled, false)
  assert.equal(disabledMeta.page, 1)
  assert.equal(disabledMeta.totalPages, 1)
  assert.equal(disabledMeta.showingFrom, 1)
  assert.equal(disabledMeta.showingTo, 65)

  const allItems = slicePage(source, disabledMeta)
  assert.equal(allItems.length, 65)
  assert.notEqual(allItems, source)
  assert.deepEqual(allItems, source)

  const page2Meta = computePagination(source.length, 2, 25, true)
  assert.deepEqual(slicePage(source, page2Meta).slice(0, 3), ["item-26", "item-27", "item-28"])
  assert.equal(slicePage(source, page2Meta).length, 25)
  assert.deepEqual(slicePage([], computePagination(0, 1, 25, true)), [])
})

test("buildPageTokens produces compact page sequences with proper ellipses", () => {
  assert.deepEqual(buildPageTokens(1, 0), [])
  assert.deepEqual(buildPageTokens(1, 1), [{ type: "page", page: 1 }])
  assert.deepEqual(
    buildPageTokens(3, 6).map((token) => (token.type === "page" ? token.page : "...")),
    [1, 2, 3, 4, 5, 6],
  )
  assert.deepEqual(
    buildPageTokens(1, 12).map((token) => (token.type === "page" ? token.page : "...")),
    [1, 2, 3, 4, "...", 12],
  )
  assert.deepEqual(
    buildPageTokens(6, 12).map((token) => (token.type === "page" ? token.page : "...")),
    [1, "...", 5, 6, 7, "...", 12],
  )
  assert.deepEqual(
    buildPageTokens(12, 12).map((token) => (token.type === "page" ? token.page : "...")),
    [1, "...", 9, 10, 11, 12],
  )
})
