import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

test("fails when a required color token is missing or cannot be measured", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pkgsteward-contrast-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = join(root, "scripts", "check-theme-contrast.mjs")
  const themes = join(root, "styles", "themes")
  mkdirSync(join(root, "scripts"))
  mkdirSync(themes, { recursive: true })
  copyFileSync(new URL("./check-theme-contrast.mjs", import.meta.url), script)
  const preset = readFileSync(new URL("../styles/themes/default.css", import.meta.url), "utf8")

  for (const replacement of ["", "--foreground: var(--undefined-color);"]) {
    const modified = preset.replace(/--foreground:\s*[^;]+;/, replacement)
    assert.notEqual(modified, preset)
    writeFileSync(join(themes, "default.css"), modified)
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 5000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /default\.css — light\r?\n[^\n]*✗[^\n]*--foreground/)
  }
})
