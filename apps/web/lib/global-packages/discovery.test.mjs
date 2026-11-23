import { test } from "node:test"
import assert from "node:assert/strict"
import { selectGlobalPackages, GLOBAL_DISCOVERY, selectVersionOptions } from "./discovery.ts"
test("global filters use actual statuses and bin text with stable numeric version sort", () => {
  const a = { name: "TEST-a", version: "2.0.0", status: "linked", bins: [{ name: "TEST-cli" }] }
  const b = { name: "TEST-b", version: "10.0.0", status: "manageable", bins: [] }
  const input = Object.freeze([a, b])
  assert.deepEqual(selectGlobalPackages(input, { ...GLOBAL_DISCOVERY, sort: "version" }, "en"), [b, a])
  assert.deepEqual(selectGlobalPackages(input, { ...GLOBAL_DISCOVERY, query: " CLI ", statuses: ["linked", "invalid"] }, "en"), [a])
  assert.deepEqual(selectGlobalPackages(input, { ...GLOBAL_DISCOVERY, statuses: ["protected"] }, "en"), [])
})
test("version search includes tags and retains a selected filtered option without mutating selection", () => {
  const rows = [{ version: "1.0.0" }, { version: "2.0.0" }]
  const selected = "1.0.0"
  assert.deepEqual(selectVersionOptions(rows, "LATEST", { latest: "2.0.0" }, selected), { matches: [rows[1]], options: rows, selectedHidden: true })
  assert.equal(selected, "1.0.0")
  assert.deepEqual(selectVersionOptions(rows, "missing", {}, ""), { matches: [], options: [], selectedHidden: false })
})

test("version search indexes tags once and keeps large results in catalog order", () => {
  const rows = Array.from({ length: 2048 }, (_, index) => ({
    version: `2.0.${2048 - index}${index % 4 === 0 ? "-rc.1" : ""}`,
  }))
  const tagValues = Object.fromEntries(rows.flatMap((row, index) =>
    index % 3 === 0 ? [[`rc-channel-${index}`, row.version]] : []))
  tagValues["rc-alias"] = rows[3].version
  let enumerations = 0
  const tags = new Proxy(tagValues, {
    ownKeys(target) {
      enumerations++
      return Reflect.ownKeys(target)
    },
  })
  const selectedIndex = 1025
  const expectedMatches = rows.filter((_, index) => index % 4 === 0 || index % 3 === 0)
  const expectedOptions = rows.filter((_, index) =>
    index === selectedIndex || index % 4 === 0 || index % 3 === 0)

  const result = selectVersionOptions(rows, " RC ", tags, rows[selectedIndex].version)

  assert.equal(enumerations, 1)
  assert.deepEqual(result, {
    matches: expectedMatches,
    options: expectedOptions,
    selectedHidden: true,
  })
})

test("global version ordering puts releases ahead of their prereleases and unknown version text last", () => {
  const row = version => ({ name: `TEST-${version}`, version, bins: [], status: "manageable" })
  const unknown = row("unknown"), prerelease = row("2.0.0-beta.1"), release = row("2.0.0")
  assert.deepEqual(selectGlobalPackages([unknown, prerelease, release], { ...GLOBAL_DISCOVERY, sort: "version" }, "en"), [release, prerelease, unknown])
})
