import { test } from "node:test"
import assert from "node:assert/strict"
import { cn } from "../utils.ts"
import { toggleGroupRootBaseClasses } from "./toggle-group-classes.ts"

// TEST cases for ToggleGroup root class generation; không phải yêu cầu nghiệp vụ.
test("wraps horizontal spaced toggle groups by default", () => {
  const classes = toggleGroupRootBaseClasses()
  assert.equal(classes.split(/\s+/).includes("flex-wrap"), true)
})

test("wraps horizontal toggle groups with custom positive spacing", () => {
  const classes = toggleGroupRootBaseClasses({ spacing: 4, orientation: "horizontal" })
  assert.equal(classes.split(/\s+/).includes("flex-wrap"), true)
})

test("does not wrap horizontal joined toggle groups with spacing=0", () => {
  const classes = toggleGroupRootBaseClasses({ spacing: 0, orientation: "horizontal" })
  assert.equal(classes.split(/\s+/).includes("flex-wrap"), false)
})

test("does not wrap vertical toggle groups", () => {
  const classes = toggleGroupRootBaseClasses({ spacing: 2, orientation: "vertical" })
  assert.equal(classes.split(/\s+/).includes("flex-wrap"), false)
})

test("allows caller className to override default wrapping via cn", () => {
  const classes = cn(toggleGroupRootBaseClasses({ spacing: 2, orientation: "horizontal" }), "flex-nowrap")
  const tokens = classes.split(/\s+/)
  assert.equal(tokens.includes("flex-nowrap"), true)
  assert.equal(tokens.includes("flex-wrap"), false)
})

test("allows caller className to opt into wrapping when spacing=0 via cn", () => {
  const classes = cn(toggleGroupRootBaseClasses({ spacing: 0, orientation: "horizontal" }), "flex-wrap")
  const tokens = classes.split(/\s+/)
  assert.equal(tokens.includes("flex-wrap"), true)
})
