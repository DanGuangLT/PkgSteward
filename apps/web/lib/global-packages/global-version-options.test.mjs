import { test } from "node:test"
import assert from "node:assert/strict"
import { newestGlobalVersions } from "./global-version-options.ts"

// TEST data; không phải yêu cầu nghiệp vụ.
test("available versions sort by descending semver precedence without mutating registry data", () => {
  const versions = ["2.0.0", "10.0.0-rc.2", "1.9.0", "10.0.0", "10.0.0-rc.10", "10.0.0-beta", "10.0.0-rc", "2.0.0+build.5"]
  const original = [...versions]
  assert.deepEqual(newestGlobalVersions(versions), ["10.0.0", "10.0.0-rc.10", "10.0.0-rc.2", "10.0.0-rc", "10.0.0-beta", "2.0.0", "2.0.0+build.5", "1.9.0"])
  assert.deepEqual(versions, original)
  assert.deepEqual(newestGlobalVersions([]), [])
  assert.deepEqual(newestGlobalVersions(["1.0.0-2", "1.0.0-a", "1.0.0-10"]), ["1.0.0-a", "1.0.0-10", "1.0.0-2"])
})
