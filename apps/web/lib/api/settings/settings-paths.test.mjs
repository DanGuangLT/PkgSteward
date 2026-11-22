import { test } from "node:test"
import assert from "node:assert/strict"
import { settingsPaths } from "./settings-paths.ts"

test("settingsPaths defines exact canonical backend/proxy suffixes", () => {
  assert.deepEqual(settingsPaths, {
    root: "/settings",
    preferences: "/settings/preferences",
    preview: "/settings/preview",
    export: "/settings/export",
    importPreview: "/settings/import/preview",
    importExecute: "/settings/import",
    resetPreview: "/settings/reset/preview",
    resetExecute: "/settings/reset",
    plugins: "/settings/plugins",
  })
})
