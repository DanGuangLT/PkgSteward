import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"

// TEST data; không phải yêu cầu nghiệp vụ. Run the actual bridge with only
// server-only and bundled alias resolution adapted to Node's test loader.
const asModule = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`
const local = file => JSON.stringify(new URL(file, import.meta.url).href)
async function loadRoute(relative) {
  let client = await readFile(new URL("./client.ts", import.meta.url), "utf8")
  client = client.replace('import "server-only"', "").replace('"./request.ts"', local("./request.ts")).replace('"./response.ts"', local("./response.ts"))
  let bridge = await readFile(new URL("./npm-runs.ts", import.meta.url), "utf8")
  assert.ok(bridge.includes('import "server-only"'))
  bridge = bridge.replace('import "server-only"', "").replace('"@/lib/api/client"', JSON.stringify(asModule(client))).replace('"@/lib/api/npm-runs-paths"', local("./npm-runs-paths.ts"))
  let route = await readFile(new URL(`../../app/api/npm-runs/${relative}route.ts`, import.meta.url), "utf8")
  route = route.replace('"@/lib/api/npm-runs"', JSON.stringify(asModule(bridge)))
    .replace('"@/lib/api/route-response"', local("./route-response.ts"))
    .replace('"@/lib/api/response"', local("./response.ts"))
  return import(asModule(route))
}
const path = "D:\\TEST\\Thư mục #&+"
const id = "00000000-0000-4000-8000-000000000001"
const input = { path, requestId: id, inputHash: "a".repeat(64), action: "install_all" }
const params = { params: Promise.resolve({ id }) }

test("six handlers await params and preserve envelope/status/details/no-store on success and errors", async t => {
  const routes = await Promise.all(["context/", "", "latest/", "[id]/", "[id]/logs/", "[id]/cancel/"].map(loadRoute))
  const request = (tail, init) => new Request(`http://localhost/api/npm-runs${tail}`, init)
  const calls = [
    () => routes[0].GET(request(`/context?${new URLSearchParams({ path })}`)),
    () => routes[1].POST(request("", { method: "POST", body: JSON.stringify(input) })),
    () => routes[2].GET(request("/latest")),
    () => routes[3].GET(request(`/${id}`), params),
    () => routes[4].GET(request(`/${id}/logs?cursor=23`), params),
    () => routes[5].POST(request(`/${id}/cancel`, { method: "POST" }), params),
  ]
  const requests = []
  for (const [i, call] of calls.entries()) {
    const statusCode = [1, 5].includes(i) ? 202 : 200
    const envelope = { statusCode, message: "TEST", code: "SUCCESS", data: { jobId: id }, timestamp: "TEST" }
    t.mock.method(globalThis, "fetch", async (url, init) => { requests.push({ url, init }); return Response.json(envelope, { status: statusCode }) })
    const response = await call()
    assert.equal(response.status, statusCode)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.deepEqual(await response.json(), envelope)
    assert.equal(requests.at(-1).init.cache, "no-store")
    for (const status of [400, 403, 404, 409, 429, 503]) {
      const details = { reason: "READERS_RUNNING" }
      t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: status, message: "TEST", code: "CONFLICT", details }, { status }))
      const error = await call()
      assert.equal(error.status, status)
      assert.equal(error.headers.get("Cache-Control"), "no-store")
      assert.deepEqual((await error.json()).details, details)
    }
    t.mock.method(globalThis, "fetch", async () => { throw new Error("TEST private") })
    assert.equal((await call()).status, 503)
  }
  assert.equal(new URL(requests[0].url).searchParams.get("path"), path)
  assert.deepEqual(JSON.parse(requests[1].init.body), input)
  assert.equal(new URL(requests[4].url).searchParams.get("cursor"), "23")
  t.mock.method(globalThis, "fetch", async () => assert.fail("invalid request must not reach BE"))
  const malformed = await routes[1].POST(request("", { method: "POST", body: "{" }))
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).code, "VALIDATION_ERROR")
  assert.equal(malformed.headers.get("Cache-Control"), "no-store")
  for (const query of ["", "path=A&path=B", "path=A&extra=B"]) assert.equal((await routes[0].GET(request(`/context?${query}`))).status, 400)
  for (const query of ["cursor=-1", "cursor=1e2", "cursor=1&cursor=2", "cursor=9007199254740992", "extra=1"]) {
    assert.equal((await routes[4].GET(request(`/${id}/logs?${query}`), params)).status, 400)
  }
})
