import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "./response.ts"
import { readJsonBody, respondWithEnvelope } from "./route-response.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const request = (body) => new Request("http://127.0.0.1/api/TEST", { method: "POST", body })

test("success keeps the backend status and envelope, never cached", async () => {
  const envelope = { statusCode: 202, message: "TEST", code: "SUCCESS", data: { previewId: "TEST" } }
  const response = await respondWithEnvelope(request("{}"), async () => envelope)
  assert.equal(response.status, 202)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(await response.json(), envelope)
})

test("errors keep status, code and details and name the local path", async () => {
  const response = await respondWithEnvelope(request("{}"), async () => {
    throw new ApiError(409, "TEST changed", "RISK_CHANGED", { paths: ["D:\\TEST"] })
  })
  const body = await response.json()
  assert.equal(response.status, 409)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(body.code, "RISK_CHANGED")
  assert.deepEqual(body.details, { paths: ["D:\\TEST"] })
  assert.equal(body.path, "/api/TEST")
})

test("unexpected errors reveal nothing", async () => {
  const response = await respondWithEnvelope(request("{}"), async () => {
    throw new Error("TEST-private")
  })
  const text = await response.text()
  assert.equal(response.status, 500)
  assert.equal(text.includes("TEST-private"), false)
})

test("readJsonBody parses JSON and rejects anything else as a validation error", async () => {
  assert.deepEqual(await readJsonBody(request('{"paths":["D:\\\\TEST"]}')), { paths: ["D:\\TEST"] })
  await assert.rejects(readJsonBody(request("TEST not JSON")), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.statusCode, 400)
    assert.equal(error.code, "VALIDATION_ERROR")
    return true
  })
})
