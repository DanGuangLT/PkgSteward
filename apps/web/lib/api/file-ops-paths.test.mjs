import { test } from "node:test"
import assert from "node:assert/strict"
import { fileOpsPaths } from "./file-ops-paths.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const id = "TEST/mã\\xem trước?# &+%"
const encoded = encodeURIComponent(id)

test("fixed paths match the file operations endpoints", () => {
  assert.equal(fileOpsPaths.cleanupPreview, "/file-ops/cleanup/preview")
  assert.equal(fileOpsPaths.deletePreview, "/file-ops/delete/preview")
  assert.equal(fileOpsPaths.execute, "/file-ops/delete/execute")
  assert.equal(fileOpsPaths.activeOperation, "/file-ops/operations/active")
})

test("ids are encoded in every path", () => {
  assert.equal(fileOpsPaths.preview(id), `/file-ops/previews/${encoded}`)
  assert.equal(fileOpsPaths.previewCancel(id), `/file-ops/previews/${encoded}/cancel`)
  assert.equal(fileOpsPaths.previewSummary(id), `/file-ops/previews/${encoded}/summary`)
  assert.equal(fileOpsPaths.operation(id), `/file-ops/operations/${encoded}`)
  assert.equal(fileOpsPaths.operationCancel(id), `/file-ops/operations/${encoded}/cancel`)
})

test("tree path round-trips Unicode # & + space and backslash", () => {
  const path = "D:\\TEST\\Thư mục # & +\\a=b%20c"
  const url = new URL(fileOpsPaths.tree(path), "http://127.0.0.1")
  assert.equal(url.pathname, "/file-ops/tree")
  assert.equal(url.hash, "")
  assert.deepEqual([...url.searchParams.keys()], ["path"])
  assert.equal(url.searchParams.get("path"), path)
})
