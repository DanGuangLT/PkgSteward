import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const preset = readFileSync(new URL("../styles/themes/default.css", import.meta.url), "utf8")
const darkRule = /((?::root\.dark,\s*)?\[data-theme="default"\]\.dark\s*)\{[^}]*\}/

function setupThemeCheck(t) {
  const root = mkdtempSync(join(tmpdir(), "pkgsteward-contrast-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = join(root, "scripts", "check-theme-contrast.mjs")
  const themes = join(root, "styles", "themes")
  mkdirSync(join(root, "scripts"))
  mkdirSync(themes, { recursive: true })
  copyFileSync(new URL("./check-theme-contrast.mjs", import.meta.url), script)
  return (css) => {
    writeFileSync(join(themes, "default.css"), css)
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 5000 })
    assert.equal(result.error, undefined)
    return result
  }
}

test("fails when a required color token is missing or cannot be measured", (t) => {
  const check = setupThemeCheck(t)
  for (const replacement of ["", "--foreground: var(--undefined-color);"]) {
    const modified = preset.replace(/--foreground:\s*[^;]+;/, replacement)
    assert.notEqual(modified, preset)
    const result = check(modified)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /default\.css — light\r?\n[^\n]*✗[^\n]*--foreground/)
  }
})

test("ignores commented-out color declarations", (t) => {
  const check = setupThemeCheck(t)
  const modified = preset.replace(/--foreground:\s*[^;]+;/, "/* $& */")
  assert.notEqual(modified, preset)
  const result = check(modified)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /default\.css — light\r?\n[^\n]*✗[^\n]*--foreground/)
})

test("requires a dark rule in each theme", (t) => {
  const check = setupThemeCheck(t)
  assert.match(preset, darkRule)
  for (const modified of [
    preset.replace(darkRule, ""),
    preset.replace(darkRule, "/* $& */"),
    preset.replace(darkRule, (rule) => rule.replaceAll(".dark", ".dark-preview")),
  ]) {
    const result = check(modified)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /default\.css:.*\.dark/)
  }
})

test("a dark rule can inherit light color tokens", (t) => {
  const check = setupThemeCheck(t)
  const modified = preset.replace(darkRule, "$1{}")
  assert.notEqual(modified, preset)
  const result = check(modified)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /default\.css — dark\r?\n[^\n]*✓[^\n]*foreground/)
})
