import { test } from "node:test"
import assert from "node:assert/strict"
import nextConfig from "../../next.config.ts"

test("every route refuses to be framed, so a confirmation cannot be clickjacked", async () => {
  const rules = await nextConfig.headers()
  const everyRoute = rules.find(({ source }) => source === "/:path*")
  assert.ok(everyRoute)
  const headers = new Map(everyRoute.headers.map(({ key, value }) => [key.toLowerCase(), value]))
  assert.equal(headers.get("content-security-policy"), "frame-ancestors 'none'")
  assert.equal(headers.get("x-frame-options"), "DENY")
})
