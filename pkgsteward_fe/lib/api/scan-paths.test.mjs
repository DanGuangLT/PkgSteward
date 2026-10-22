import { test } from "node:test"
import assert from "node:assert/strict"
import { scanPaths } from "./scan-paths.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
test("start and latest paths match the scanner endpoints", () => {
  assert.equal(scanPaths.start, "/scans")
  assert.equal(scanPaths.latest, "/scans/latest")
})

test("job and cancel encode IDs including slash, question mark, hash and percent", () => {
  for (const id of ["TEST-scan", "TEST/id?query#hash", "TEST space%", "TEST-đường-dẫn"]) {
    assert.equal(scanPaths.job(id), `/scans/${encodeURIComponent(id)}`)
    assert.equal(scanPaths.cancel(id), `/scans/${encodeURIComponent(id)}/cancel`)
  }
})
