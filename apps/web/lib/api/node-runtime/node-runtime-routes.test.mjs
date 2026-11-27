import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import { test } from "node:test"

// Load the real handlers and client in Node by adapting Next.js imports.
const local = path => JSON.stringify(new URL(path, import.meta.url).href)
const asModule = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`

async function loadRoute(relative) {
  const client = (await readFile(new URL("../client.ts", import.meta.url), "utf8"))
    .replace('import "server-only"', "")
    .replace('"./request.ts"', local("../request.ts"))
    .replace('"./response.ts"', local("../response.ts"))
  const bridge = (await readFile(new URL("./node-runtime.ts", import.meta.url), "utf8"))
    .replace('import "server-only"', "")
    .replace('"../client.ts"', JSON.stringify(asModule(client)))
    .replace('"./node-runtime-paths.ts"', local("./node-runtime-paths.ts"))
  const route = (await readFile(new URL(`../../../app/api/node-runtime/${relative}route.ts`, import.meta.url), "utf8"))
    .replace('"@/lib/api/node-runtime/node-runtime"', JSON.stringify(asModule(bridge)))
    .replace('"@/lib/api/response"', local("../response.ts"))
    .replace('"@/lib/api/route-response"', local("../route-response.ts"))
  return import(asModule(route))
}

const routePath = "/api/node-runtime"
const projectRoutePath = `${routePath}/project`
const projectPath = "D:\\TEST\\Việt #&+\\app"
const projectQuery = `?${new URLSearchParams({ path: projectPath })}`
const request = (pathname, query, init) => new Request(`http://localhost${pathname}${query}`, init)

test("overview forwards refresh=true and uses the default request for false or omitted refresh", async t => {
  const { GET } = await loadRoute("")
  const envelope = { statusCode: 200, message: "TEST", data: { scanId: null, projects: [] } }
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(envelope))

  for (const [query, expectedQuery] of [["?refresh=true", "?refresh=true"], ["?refresh=false", ""], ["", ""]]) {
    const response = await GET(request(routePath, query))
    const [url, init] = fetch.mock.calls.at(-1).arguments
    assert.ok(new URL(url).pathname.endsWith("/node-runtime"))
    assert.equal(new URL(url).search, expectedQuery, query)
    assert.equal(init.method, "GET")
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.deepEqual(await response.json(), envelope)
  }
  assert.equal(fetch.mock.callCount(), 3)
})

test("project route forwards the encoded path and request cancellation", async t => {
  const { GET } = await loadRoute("project/")
  const envelope = { statusCode: 200, message: "TEST", data: { project: { path: projectPath } } }
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(envelope))
  const controller = new AbortController()
  const response = await GET(request(projectRoutePath, projectQuery, { signal: controller.signal }))

  assert.equal(fetch.mock.callCount(), 1)
  const [url, init] = fetch.mock.calls[0].arguments
  const destination = new URL(url)
  assert.ok(destination.pathname.endsWith("/node-runtime/project"))
  assert.deepEqual([...destination.searchParams], [["path", projectPath]])
  assert.equal(init.method, "GET")
  assert.equal(init.signal.aborted, false)
  controller.abort()
  assert.equal(init.signal.aborted, true)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(await response.json(), envelope)
})

test("routes reject invalid query parameters before calling the backend", async t => {
  const overview = await loadRoute("")
  const project = await loadRoute("project/")
  const fetch = t.mock.method(globalThis, "fetch", async () => assert.fail("invalid query reached backend"))
  const cases = [
    [overview.GET, routePath, ["?refresh=", "?refresh=1", "?refresh=true&refresh=true", "?refresh=true&other=1"]],
    [project.GET, projectRoutePath, ["", "?path=", `${projectQuery}&path=another`, `${projectQuery}&other=1`]],
  ]

  for (const [get, pathname, queries] of cases) {
    for (const query of queries) {
      const response = await get(request(pathname, query))
      const context = pathname + query
      assert.equal(response.status, 400, context)
      assert.equal(response.headers.get("Cache-Control"), "no-store", context)
      const body = await response.json()
      assert.equal(body.statusCode, 400, context)
      assert.equal(body.code, "VALIDATION_ERROR", context)
      assert.equal(body.path, pathname, context)
    }
  }
  assert.equal(fetch.mock.callCount(), 0)
})
