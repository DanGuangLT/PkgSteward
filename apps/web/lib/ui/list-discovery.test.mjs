import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeListQuery, createListTextMatcher, selectListItems, countMatchingItems } from "./list-discovery.ts"

test("text matching trims and normalizes Unicode, case and repeated whitespace without dropping accents", () => {
  assert.equal(normalizeListQuery("  MÃ  \n NGUỒN  "), "mã nguồn")
  const matches = createListTextMatcher("  MÃ \t NGUỒN ")
  assert.equal(matches("Mã nguồn".normalize("NFD")), true)
  assert.equal(matches(null, undefined, "MÃ    NGUỒN"), true)
  assert.equal(matches("Ma nguon"), false)
  assert.equal(matches("Mã", "nguồn"), false)
})

test("empty search matches absent values and a nonempty search does not invent values", () => {
  assert.equal(createListTextMatcher(" \t ")(null, undefined), true)
  assert.equal(createListTextMatcher("null")(null, undefined), false)
  assert.equal(createListTextMatcher("missing")("TEST"), false)
})

test("selection intersects its predicate and keeps source order on sort ties without mutation", () => {
  const first = Object.freeze({ id: "TEST-first", rank: 1, keep: true })
  const hidden = Object.freeze({ id: "TEST-hidden", rank: 0, keep: false })
  const second = Object.freeze({ id: "TEST-second", rank: 1, keep: true })
  const input = Object.freeze([first, hidden, second])
  assert.deepEqual(selectListItems(input, item => item.keep, (a, b) => a.rank - b.rank), [first, second])
  assert.deepEqual(selectListItems(input, () => true), input)
  assert.notEqual(selectListItems(input, () => true), input)
  assert.deepEqual(input, [first, hidden, second])
  assert.equal(countMatchingItems(input, item => !item.keep), 1)
  assert.equal(countMatchingItems([], () => true), 0)
  assert.deepEqual(selectListItems(input, () => false), [])
})
