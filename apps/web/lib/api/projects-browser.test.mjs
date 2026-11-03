import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import { getBrowserProject, startBrowserProjectAnalysis, pollBrowserProjectAnalysis, cancelBrowserProjectAnalysis } from "./projects-browser.ts"
import { ApiError } from "./response.ts"

// Dữ liệu TEST không phải yêu cầu nghiệp vụ.
const path = "D:\\TEST\\Tiếng Việt #&+%?"
const id = "TEST/job#&+"
const data = { jobId: id, status: "running", diskUsage: null }
const envelope = (value = data, statusCode = 200) => ({ statusCode, message: "OK", data: value })
const calls = [
  signal => getBrowserProject(path, signal),
  signal => startBrowserProjectAnalysis({ path }, signal),
  signal => pollBrowserProjectAnalysis(id, signal),
  signal => cancelBrowserProjectAnalysis(id, signal),
]

test("browser requests stay same-origin and forward JSON, signal and no-store", async t => {
  const requests = []
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init })
    return Response.json(envelope())
  })
  for (const call of calls) {
    const controller = new AbortController()
    assert.deepEqual(await call(controller.signal), data)
    const { init } = requests.at(-1)
    assert.equal(init.cache, "no-store")
    assert.equal(init.signal.aborted, false)
    controller.abort()
    assert.equal(init.signal.aborted, true)
  }
  assert.equal(requests.every(({ url }) => url.startsWith("/api/projects")), true)
  assert.deepEqual(requests.map(({ url, init }) => [new URL(url, "http://localhost").pathname, init.method]), [
    ["/api/projects", "GET"], ["/api/projects/analyses", "POST"],
    [`/api/projects/analyses/${encodeURIComponent(id)}`, "GET"],
    [`/api/projects/analyses/${encodeURIComponent(id)}/cancel`, "POST"],
  ])
  assert.equal(new URL(requests[0].url, "http://localhost").searchParams.get("path"), path)
  assert.deepEqual(JSON.parse(requests[1].init.body), { path })
  assert.equal(new Headers(requests[1].init.headers).get("Content-Type"), "application/json")
  for (const index of [0, 2, 3]) assert.equal(requests[index].init.body, undefined)
})

test("all browser methods preserve errors/details and use shared transport/parser", async t => {
  for (const call of calls) {
    for (const status of [400, 403, 404, 409, 429, 503]) {
      const details = { reason: "ANALYSIS_RUNNING", jobId: id, path }
      t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: status, message: "TEST", code: "TEST_CODE", details }, { status }))
      await assert.rejects(call(), error => error instanceof ApiError && error.statusCode === status && error.code === "TEST_CODE" && assert.deepEqual(error.details, details) === undefined)
    }
    t.mock.method(globalThis, "fetch", async () => { throw new Error("TEST offline") })
    await assert.rejects(call(), { statusCode: 503, code: "BACKEND_UNAVAILABLE" })
    for (const response of [new Response("TEST invalid JSON"), Response.json({ statusCode: 200, message: "OK" })]) {
      t.mock.method(globalThis, "fetch", async () => response)
      await assert.rejects(call(), { statusCode: 502, code: "INVALID_RESPONSE" })
    }
    const controller = new AbortController()
    controller.abort()
    t.mock.method(globalThis, "fetch", async (_url, init) => init.signal.throwIfAborted())
    await assert.rejects(call(controller.signal), { name: "AbortError" })
  }
})

// Execute actual handlers/server wrappers with only server-only/alias resolution adapted
// for Node's framework-free runner. HTTP stays mocked; no Next server is started.
const asModule = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`
async function loadRoute(relative) {
  let client = await readFile(new URL("./client.ts", import.meta.url), "utf8")
  client = client.replace('import "server-only"', "")
    .replace('"./request.ts"', JSON.stringify(new URL("./request.ts", import.meta.url).href))
    .replace('"./response.ts"', JSON.stringify(new URL("./response.ts", import.meta.url).href))
  let projects = await readFile(new URL("./projects.ts", import.meta.url), "utf8")
  projects = projects.replace('import "server-only"', "")
    .replace('"@/lib/api/client"', JSON.stringify(asModule(client)))
    .replace('"@/lib/api/projects-paths"', JSON.stringify(new URL("./projects-paths.ts", import.meta.url).href))
  let route = await readFile(new URL(`../../app/api/projects/${relative}route.ts`, import.meta.url), "utf8")
  route = route.replace('"@/lib/api/projects"', JSON.stringify(asModule(projects)))
    .replace('"@/lib/api/response"', JSON.stringify(new URL("./response.ts", import.meta.url).href))
  return import(asModule(route))
}

test("four bridge handlers preserve envelopes, await params, reject bad JSON and map BE outage", async t => {
  const routes = await Promise.all(["", "analyses/", "analyses/[id]/", "analyses/[id]/cancel/"].map(loadRoute))
  const requests = []
  const invoke = [
    () => routes[0].GET(new Request(`http://localhost/api/projects?${new URLSearchParams({ path })}`)),
    () => routes[1].POST(new Request("http://localhost/api/projects/analyses", { method: "POST", body: JSON.stringify({ path }) })),
    () => routes[2].GET(new Request("http://localhost/api/projects/analyses/TEST"), { params: Promise.resolve({ id }) }),
    () => routes[3].POST(new Request("http://localhost/api/projects/analyses/TEST/cancel", { method: "POST" }), { params: Promise.resolve({ id }) }),
  ]
  for (const [index, call] of invoke.entries()) {
    const status = index === 1 ? 202 : 200
    t.mock.method(globalThis, "fetch", async (url, init) => {
      requests.push({ url, init })
      return Response.json(envelope(data, status), { status })
    })
    const response = await call()
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), envelope(data, status))
    assert.equal(requests.at(-1).init.cache, "no-store")
    if (index === 0 || index === 2) assert.equal(response.headers.get("Cache-Control"), "no-store")
    t.mock.method(globalThis, "fetch", async () => { throw new Error("TEST offline") })
    const offline = await call()
    assert.equal(offline.status, 503)
    assert.equal((await offline.json()).code, "BACKEND_UNAVAILABLE")
    const details = { reason: "INPUT_CHANGED" }
    t.mock.method(globalThis, "fetch", async () => Response.json({ statusCode: 409, message: "TEST", code: "CONFLICT", details }, { status: 409 }))
    const conflict = await call()
    assert.equal(conflict.status, 409)
    assert.deepEqual((await conflict.json()).details, details)
    if (index === 0 || index === 2) assert.equal(conflict.headers.get("Cache-Control"), "no-store")
  }
  assert.equal(new URL(requests[0].url).searchParams.get("path"), path)
  assert.deepEqual(JSON.parse(requests[1].init.body), { path })
  assert.equal(new URL(requests[2].url).pathname.endsWith(`/analyses/${encodeURIComponent(id)}`), true)
  assert.equal(new URL(requests[3].url).pathname.endsWith(`/analyses/${encodeURIComponent(id)}/cancel`), true)
  t.mock.method(globalThis, "fetch", async () => assert.fail("bad JSON must not reach BE"))
  const bad = await routes[1].POST(new Request("http://localhost/api/projects/analyses", { method: "POST", body: "{" }))
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).code, "VALIDATION_ERROR")
  const repeated = await routes[0].GET(new Request("http://localhost/api/projects?path=TEST&path=OTHER"))
  assert.equal(repeated.status, 400)
})
