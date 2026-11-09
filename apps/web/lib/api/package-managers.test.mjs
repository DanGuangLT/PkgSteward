import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"

// TEST data; run real handlers/client with only server-only/aliases adapted for Node.
const asModule = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`
const local = file => JSON.stringify(new URL(file, import.meta.url).href)
async function loadRoute(relative) {
  let client = await readFile(new URL("./client.ts", import.meta.url), "utf8")
  client = client.replace('import "server-only"', "").replace('"./request.ts"', local("./request.ts")).replace('"./response.ts"', local("./response.ts"))
  let bridge = await readFile(new URL("./package-managers.ts", import.meta.url), "utf8")
  assert.ok(bridge.includes('import "server-only"'))
  bridge = bridge.replace('import "server-only"', "").replace('"./client.ts"', JSON.stringify(asModule(client)))
    .replace('"./package-managers-paths.ts"', local("./package-managers-paths.ts"))
  let route = await readFile(new URL(`../../app/api/package-managers/${relative}route.ts`, import.meta.url), "utf8")
  route = route.replace('"@/lib/api/package-managers"', JSON.stringify(asModule(bridge)))
    .replace('"@/lib/api/route-response"', local("./route-response.ts"))
    .replace('"@/lib/api/response"', local("./response.ts"))
  return import(asModule(route))
}
const id = "00000000-0000-4000-8000-000000000001"
const projectPath = "D:\\TEST\\Việt #&+\\app"
const requests = [
  ["project/", "GET"],
  ["versions/", "POST", { requestId: id, path: projectPath, manager: "pnpm" }],
  ["project/preview/", "POST", { requestId: id, path: projectPath, manager: "pnpm", targetVersion: "latest" }],
  ["project/execute/", "POST", { previewId: id, requestId: id, confirm: true, acknowledgedRisks: [] }],
  ["jobs/latest/", "GET"], ["jobs/[id]/", "GET"], ["jobs/[id]/cancel/", "POST"],
]
const params = { params: Promise.resolve({ id }) }
const tail = path => path.replace("[id]", id).replace(/\/$/, "")
const request = (path, method, body, query = "") => new Request(`http://localhost/api/package-managers/${tail(path)}${query}`, {
  method, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
})
const projectQuery = `?${new URLSearchParams({ path: projectPath })}`

test("seven real handlers preserve status/envelope/details/no-store and await Next16 params", async t => {
  for (const [path, method, body] of requests) {
    const route = await loadRoute(path)
    const query = path === "project/" ? projectQuery : ""
    const invoke = () => route[method](request(path, method, body, query), params)
    const statusCode = method === "POST" && !path.endsWith("cancel/") ? 202 : 200
    const envelope = { statusCode, message: "TEST", code: "SUCCESS", data: { jobId: id }, timestamp: "TEST-time" }
    let captured
    t.mock.method(globalThis, "fetch", async (url, init) => { captured = { url, init }; return Response.json(envelope, { status: statusCode }) })
    const result = await invoke()
    assert.equal(result.status, statusCode)
    assert.equal(result.headers.get("Cache-Control"), "no-store")
    assert.deepEqual(await result.json(), envelope)
    assert.equal(new URL(captured.url).pathname, `/api/v1/package-managers/${tail(path)}`)
    if (path === "project/") assert.equal(new URL(captured.url).searchParams.get("path"), projectPath)
    assert.equal(captured.init.method, method)
    assert.equal(captured.init.cache, "no-store")
    assert.equal(captured.init.body, body ? JSON.stringify(body) : undefined)
    if (method === "POST") assert.equal(captured.init.signal, undefined)
    for (const status of [400, 403, 404, 409, 429, 503]) {
      const details = { reason: "PREVIEW_CHANGED" }
      t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: status, message: "TEST", code: "CONFLICT", details }, { status }))
      const error = await invoke()
      assert.equal(error.status, status)
      assert.equal(error.headers.get("Cache-Control"), "no-store")
      assert.deepEqual((await error.json()).details, details)
    }
    let count = 0
    t.mock.method(globalThis, "fetch", async () => { count++; throw new Error("TEST private error") })
    assert.equal((await invoke()).status, 503)
    assert.equal(count, 1)
  }
})

test("invalid JSON and project query fail at bridge with no BE call", async t => {
  for (const [path, method, body] of requests.filter(([, , body]) => body)) {
    const route = await loadRoute(path)
    t.mock.method(globalThis, "fetch", async () => assert.fail("invalid JSON must never reach BE"))
    const response = await route[method](request(path, method, "{"), params)
    assert.equal(response.status, 400)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.equal((await response.json()).code, "VALIDATION_ERROR")
  }
  const route = await loadRoute("project/")
  for (const query of ["", "?path=", "?path=a&path=b", `${projectQuery}&extra=1`, "?other=1"]) {
    t.mock.method(globalThis, "fetch", async () => assert.fail("invalid query must never reach BE"))
    const response = await route.GET(request("project/", "GET", undefined, query))
    assert.equal(response.status, 400)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.equal((await response.json()).code, "VALIDATION_ERROR")
  }
})
