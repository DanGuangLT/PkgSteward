import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

function createFixture(t, vi = { section: { title: "Tiêu đề" } }) {
  const root = mkdtempSync(join(tmpdir(), "pkgsteward-catalog-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = join(root, "scripts", "check-messages.mjs")
  const messages = join(root, "messages")
  mkdirSync(join(root, "scripts"))
  mkdirSync(join(root, "i18n"))
  mkdirSync(messages)
  copyFileSync(new URL("./check-messages.mjs", import.meta.url), script)
  writeFileSync(
    join(root, "i18n", "config.ts"),
    'export const locales = ["vi", "en"] as const\nexport const defaultLocale = "vi"\n',
  )
  writeFileSync(join(messages, "vi.json"), JSON.stringify(vi))

  return (en, { malformedFile } = {}) => {
    if (en !== undefined) writeFileSync(join(messages, "en.json"), JSON.stringify(en))
    if (malformedFile) writeFileSync(join(messages, malformedFile), '{"section":')
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 5000 })
    assert.equal(result.error, undefined)
    return result
  }
}

test("fails when a configured locale has no catalog file", (t) => {
  const result = createFixture(t)()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing.+messages\/en\.json/i)
})

test("names the catalog with invalid JSON syntax", (t) => {
  for (const malformedFile of ["vi.json", "en.json"]) {
    const check = createFixture(t)
    const result = check({}, { malformedFile })
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes("Invalid JSON in messages/" + malformedFile))
    assert.match(result.stderr, /Unexpected end of JSON input/)
  }
})

test("rejects translation values that are neither text nor a namespace", (t) => {
  const check = createFixture(t)
  for (const title of [5, true, null, ["Array"]]) {
    const result = check({ section: { title } })
    assert.equal(result.status, 1, JSON.stringify(title))
    assert.match(result.stderr, /en\.json.*section\.title/)
  }
})

test("rejects a catalog whose root is not a message object", (t) => {
  const check = createFixture(t, [])
  const result = check({})
  assert.equal(result.status, 1)
  assert.match(result.stderr, /vi\.json.*message object/)
})

test("rejects literal dots inside message keys", (t) => {
  const check = createFixture(t)
  for (const messages of [{ "section.title": "Flat" }, { section: { "group.title": "Nested" } }]) {
    const result = check(messages)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /en\.json.*section\.(?:group\.)?title.*dot/)
  }
})

test("rejects message and namespace conflicts with the default catalog", (t) => {
  const check = createFixture(t)
  for (const [messages, path] of [
    [{ section: { title: {} } }, /en\.json.*section\.title.*vi\.json/],
    [{ section: "Text" }, /en\.json.*"section".*vi\.json/],
  ]) {
    const result = check(messages)
    assert.equal(result.status, 1)
    assert.match(result.stderr, path)
  }
})

test("warns about missing keys and fails for extra keys", (t) => {
  const check = createFixture(t)
  const missing = check({})
  assert.equal(missing.status, 0, missing.stderr)
  assert.match(missing.stdout, /section\.title/)

  const emptyNamespace = check({ section: {} })
  assert.equal(emptyNamespace.status, 0, emptyNamespace.stderr)
  assert.match(emptyNamespace.stdout, /section\.title/)

  const extra = check({ section: { title: "Title" }, extra: "Unexpected key" })
  assert.equal(extra.status, 1)
  assert.match(extra.stdout, /\bextra\b/)
})
