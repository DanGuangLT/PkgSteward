import { test } from "node:test"
import assert from "node:assert/strict"
import { packageManagersPaths } from "./package-managers-paths.ts"

// TEST data; not business requirements.
test("package manager routes mirror BE and encode project paths and opaque ids", () => {
  assert.equal(packageManagersPaths.versions, "/package-managers/versions")
  assert.equal(packageManagersPaths.preview, "/package-managers/project/preview")
  assert.equal(packageManagersPaths.execute, "/package-managers/project/execute")
  assert.equal(packageManagersPaths.latest, "/package-managers/jobs/latest")
  const path = "D:\\TEST\\Việt #?&+%\\app"
  assert.equal(packageManagersPaths.project(path), `/package-managers/project?${new URLSearchParams({ path })}`)
  assert.equal(new URLSearchParams(packageManagersPaths.project(path).split("?")[1]).get("path"), path)
  const id = "TEST/Việt #?&+%"
  const base = `/package-managers/jobs/${encodeURIComponent(id)}`
  assert.equal(packageManagersPaths.job(id), base)
  assert.equal(packageManagersPaths.cancel(id), `${base}/cancel`)
})
