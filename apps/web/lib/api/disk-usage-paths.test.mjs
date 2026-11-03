import { test } from "node:test"
import assert from "node:assert/strict"
import { diskUsagePaths } from "./disk-usage-paths.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
test("start path matches the disk usage endpoint", () => {
  assert.equal(diskUsagePaths.start, "/disk-usage")
})

test("encoded id/path including Unicode # & + backslash", () => {
  const id = "TEST/ổ đĩa\\thư mục?# &+%"
  assert.equal(diskUsagePaths.job(id), `/disk-usage/${encodeURIComponent(id)}`)
  assert.equal(diskUsagePaths.cancel(id), `/disk-usage/${encodeURIComponent(id)}/cancel`)
})
