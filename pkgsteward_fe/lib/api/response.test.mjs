import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError, readApiResponse, toApiErrorResponse, unwrapApiData } from "./response.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
const invalidResponse = (error) => {
  assert.ok(error instanceof ApiError)
  assert.equal(error.statusCode, 502)
  assert.equal(error.code, "INVALID_RESPONSE")
  return true
}

test("success 200/202 preserves the complete envelope", async () => {
  for (const statusCode of [200, 202]) {
    const body = {
      statusCode,
      message: "OK",
      code: "OK",
      data: { scanId: "TEST-scan", status: "running" },
      timestamp: "2026-10-22T05:00:00.000Z",
      path: "/api/v1/scans",
    }
    assert.deepEqual(await readApiResponse(Response.json(body, { status: statusCode })), body)
  }
})

test("unwrap returns data, including null and falsy values", () => {
  for (const data of [{ scanId: "TEST-scan" }, [], null, false, 0, ""]) {
    assert.equal(unwrapApiData({ statusCode: 200, message: "OK", data }), data)
  }
})

test("VALIDATION_ERROR retains its message and details", async () => {
  const details = [{ property: "id", constraints: { isUuid: "id must be a UUID" } }]
  await assert.rejects(
    readApiResponse(Response.json({
      statusCode: 400,
      message: "Validation failed",
      code: "VALIDATION_ERROR",
      details,
    }, { status: 400 })),
    (error) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.statusCode, 400)
      assert.equal(error.message, "Validation failed")
      assert.equal(error.code, "VALIDATION_ERROR")
      assert.deepEqual(error.details, details)
      return true
    }
  )
})

test("404/429/500 retain HTTP status and error code through route conversion", async () => {
  for (const [statusCode, code] of [[404, "NOT_FOUND"], [429, "RATE_LIMITED"], [500, "INTERNAL_SERVER_ERROR"]]) {
    await assert.rejects(
      readApiResponse(Response.json({ statusCode, message: code, code }, { status: statusCode })),
      (error) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.statusCode, statusCode)
        assert.equal(error.code, code)
        const result = toApiErrorResponse(error, "/api/scans/TEST-scan")
        assert.equal(result.status, statusCode)
        assert.equal(result.body.statusCode, statusCode)
        assert.equal(result.body.code, code)
        return true
      }
    )
  }
})

test("invalid JSON, HTML, empty, null, array and invalid envelope fields reject with safe 502", async () => {
  const bodies = [
    "{broken TEST-json",
    "<html>TEST-private upstream body</html>",
    "",
    "null",
    "[]",
    '"TEST-string"',
    '{"message":"TEST-missing status"}',
    '{"statusCode":200}',
    '{"statusCode":"200","message":"TEST-string status"}',
    '{"statusCode":200.5,"message":"TEST-fraction status"}',
    '{"statusCode":99,"message":"TEST-invalid HTTP status"}',
    '{"statusCode":600,"message":"TEST-invalid HTTP status"}',
  ]
  for (const body of bodies) {
    await assert.rejects(readApiResponse(new Response(body)), (error) => {
      invalidResponse(error)
      assert.equal(error.message.includes("TEST-"), false)
      return true
    })
  }
})

test("missing success data rejects when unwrapped", async () => {
  const body = await readApiResponse(Response.json({ statusCode: 200, message: "OK" }))
  assert.throws(() => unwrapApiData(body), invalidResponse)
  assert.throws(() => unwrapApiData({ statusCode: 200, message: "OK", data: undefined }), invalidResponse)
})

test("HTTP/body status mismatches reject with 502 on both success and error", async () => {
  for (const [status, statusCode] of [[200, 202], [200, 500], [404, 200]]) {
    await assert.rejects(
      readApiResponse(Response.json({ statusCode, message: "TEST-mismatch" }, { status })),
      invalidResponse
    )
  }
})

test("unknown errors become a safe 500 without leaking messages or details", () => {
  for (const error of [new Error("TEST-secret"), { message: "TEST-secret", details: "TEST-secret" }, null]) {
    const { status, body } = toApiErrorResponse(error, "/api/scans")
    assert.equal(status, 500)
    assert.equal(body.statusCode, 500)
    assert.equal(body.code, "INTERNAL_SERVER_ERROR")
    assert.equal(JSON.stringify(body).includes("TEST-secret"), false)
    assert.equal("details" in body, false)
  }
})

test("route errors add a fresh ISO timestamp/path and keep validation details", () => {
  const details = [{ property: "id", constraints: { isUuid: "id must be a UUID" } }]
  const before = Date.now()
  const { status, body } = toApiErrorResponse(
    new ApiError(400, "Validation failed", "VALIDATION_ERROR", details),
    "/api/scans/TEST-invalid-id"
  )
  assert.equal(status, 400)
  assert.deepEqual(body, {
    statusCode: 400,
    message: "Validation failed",
    code: "VALIDATION_ERROR",
    timestamp: body.timestamp,
    path: "/api/scans/TEST-invalid-id",
    details,
  })
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp)
  assert.ok(Date.parse(body.timestamp) >= before)
  assert.ok(Date.parse(body.timestamp) <= Date.now())
})
