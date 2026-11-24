import assert from "node:assert/strict"
import { test } from "node:test"

import {
  getBrowserNodeRuntimeOverview,
  getBrowserProjectNodeRuntime,
} from "./node-runtime-browser.ts"

// TEST data; not business requirements.
const samplePath = "D:\\TEST\\Việt #&+\\app"

test("browser node runtime calls use same-origin /api/node-runtime with no-store and forward signal", async (t) => {
  let captured
  const overviewData = { activeNodeVersion: "24.19.0", projects: [] }
  t.mock.method(globalThis, "fetch", async (url, init) => {
    captured = { url, init }
    return Response.json({ statusCode: 200, message: "TEST", data: overviewData })
  })

  const controller = new AbortController()
  assert.deepEqual(await getBrowserNodeRuntimeOverview(false, controller.signal), overviewData)
  assert.equal(captured.url, "/api/node-runtime")
  assert.equal(captured.init.method, "GET")
  assert.equal(captured.init.cache, "no-store")
  controller.abort()
  assert.equal(captured.init.signal.aborted, true)

  t.mock.method(globalThis, "fetch", async (url, init) => {
    captured = { url, init }
    return Response.json({ statusCode: 200, message: "TEST", data: overviewData })
  })
  await getBrowserNodeRuntimeOverview(true)
  assert.equal(captured.url, "/api/node-runtime?refresh=true")
})

test("getBrowserProjectNodeRuntime encodes path and unwraps data or throws ApiError", async (t) => {
  let captured
  const detailData = { activeNodeVersion: "24.19.0", project: { path: samplePath } }
  t.mock.method(globalThis, "fetch", async (url, init) => {
    captured = { url, init }
    return Response.json({ statusCode: 200, message: "TEST", data: detailData })
  })

  assert.deepEqual(await getBrowserProjectNodeRuntime(samplePath), detailData)
  assert.equal(
    captured.url,
    `/api/node-runtime/project?${new URLSearchParams({ path: samplePath })}`,
  )
  assert.equal(captured.init.cache, "no-store")

  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { statusCode: 403, message: "Denied", code: "FORBIDDEN" },
      { status: 403 },
    ),
  )
  await assert.rejects(getBrowserProjectNodeRuntime(samplePath), {
    statusCode: 403,
    code: "FORBIDDEN",
  })
})
