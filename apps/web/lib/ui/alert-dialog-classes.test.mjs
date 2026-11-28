import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { cn } from "../utils.ts"
import { alertDialogContentBaseClasses } from "./alert-dialog-classes.ts"

// TEST cases for AlertDialogContent class generation and confirmation dialog sizing; không phải yêu cầu nghiệp vụ.
test("default alert dialog content base classes lock a single min-w-0 grid column and allow sm:max-w overrides", () => {
  const tokens = alertDialogContentBaseClasses().split(/\s+/)
  assert.equal(tokens.includes("grid-cols-1"), true)
  assert.equal(tokens.includes("min-w-0"), true)
  assert.equal(tokens.includes("w-[calc(100%-2rem)]"), true)
  assert.equal(tokens.includes("border"), true)
  assert.equal(tokens.includes("border-border"), true)
  assert.equal(tokens.includes("sm:max-w-[480px]"), true)
  assert.equal(
    tokens.some((token) => token.startsWith("data-[size=default]:sm:max-w-")),
    false
  )
})

test("sm alert dialog content base classes constrain width to max-w-xs without sm:max-w-[480px]", () => {
  const tokens = alertDialogContentBaseClasses("sm").split(/\s+/)
  assert.equal(tokens.includes("w-[calc(100%-2rem)]"), true)
  assert.equal(tokens.includes("max-w-xs"), true)
  assert.equal(tokens.includes("grid-cols-1"), true)
  assert.equal(tokens.includes("min-w-0"), true)
  assert.equal(tokens.includes("sm:max-w-[480px]"), false)
})

test("caller sm:max-w-4xl cleanly replaces default sm:max-w-[480px] via cn()", () => {
  const tokens = cn(alertDialogContentBaseClasses("default"), "sm:max-w-4xl").split(/\s+/)
  assert.equal(tokens.includes("sm:max-w-4xl"), true)
  assert.equal(tokens.includes("sm:max-w-[480px]"), false)
})

test("caller sm:max-w-2xl cleanly replaces default sm:max-w-[480px] via cn()", () => {
  const tokens = cn(alertDialogContentBaseClasses("default"), "sm:max-w-2xl").split(/\s+/)
  assert.equal(tokens.includes("sm:max-w-2xl"), true)
  assert.equal(tokens.includes("sm:max-w-[480px]"), false)
})

test("existing data-[size=default]:sm:max-w-2xl overrides remain intact via cn()", () => {
  const tokens = cn(
    alertDialogContentBaseClasses("default"),
    "data-[size=default]:sm:max-w-2xl"
  ).split(/\s+/)
  assert.equal(tokens.includes("data-[size=default]:sm:max-w-2xl"), true)
})

test("settings and plugin confirmation dialogs use wide non-overflowing layouts", () => {
  const settingsDialogSource = readFileSync(
    new URL("../../components/features/settings/settings-confirm-dialog.tsx", import.meta.url),
    "utf8"
  )
  assert.match(settingsDialogSource, /\bsm:max-w-4xl\b/)
  assert.match(settingsDialogSource, /\boverflow-x-hidden\b/)
  assert.equal(settingsDialogSource.includes("sm:max-w-[640px]"), false)

  const pluginDialogSource = readFileSync(
    new URL("../../components/features/settings/plugin-confirm-dialog.tsx", import.meta.url),
    "utf8"
  )
  assert.match(pluginDialogSource, /\bsm:max-w-2xl\b/)
  assert.match(pluginDialogSource, /\boverflow-x-hidden\b/)
  assert.equal(pluginDialogSource.includes("sm:max-w-[580px]"), false)
})
