import { test } from "node:test"
import assert from "node:assert/strict"
import { projectsPaths } from "./projects-paths.ts"

// Dữ liệu TEST không phải yêu cầu nghiệp vụ.
test("project API URLs roundtrip Windows paths and encode job ids", () => {
  const path = "D:\\TEST\\Thư mục # & + %?\\node_modules"
  const id = "TEST/việc\\#&+%?"
  const url = new URL(projectsPaths.detail(path), "http://localhost")
  assert.equal(url.pathname, "/projects")
  assert.deepEqual([...url.searchParams], [["path", path]])
  assert.equal(projectsPaths.start, "/projects/analyses")
  assert.equal(projectsPaths.job(id), `/projects/analyses/${encodeURIComponent(id)}`)
  assert.equal(projectsPaths.cancel(id), `/projects/analyses/${encodeURIComponent(id)}/cancel`)
})
