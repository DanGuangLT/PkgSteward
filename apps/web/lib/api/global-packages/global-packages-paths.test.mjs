import { test } from "node:test"
import assert from "node:assert/strict"
import { globalPackagesPaths } from "./global-packages-paths.ts"

// TEST data; not business requirements.
test("global routes mirror BE, encode opaque ids and preserve safe cursors", () => {
  assert.equal(globalPackagesPaths.snapshot, "/global-packages")
  for (const action of ["inventory", "versions", "preview", "execute"]) {
    assert.equal(globalPackagesPaths[action], `/global-packages/${action}`)
  }
  assert.equal(globalPackagesPaths.latest, "/global-packages/jobs/latest")
  const id = "TEST/Việt #?&+%"
  const base = `/global-packages/jobs/${encodeURIComponent(id)}`
  assert.equal(globalPackagesPaths.job(id), base)
  assert.equal(globalPackagesPaths.cancel(id), `${base}/cancel`)
  assert.equal(globalPackagesPaths.logs(id), `${base}/logs?cursor=0`)
  for (const cursor of [0, 23, Number.MAX_SAFE_INTEGER]) {
    assert.equal(globalPackagesPaths.logs(id, cursor), `${base}/logs?cursor=${cursor}`)
  }
  for (const cursor of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => globalPackagesPaths.logs(id, cursor), RangeError)
  }
})
