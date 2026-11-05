import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import { globalError } from "./global-types.ts"

// TEST data; không phải yêu cầu nghiệp vụ. No package manager or filesystem operations.
for (const reason of ["PNPM_GLOBAL_NOT_CONFIGURED", "GLOBAL_GROUP_UNSUPPORTED"]) {
  test(`global errors recognize ${reason} in details without relying on message text`, () => {
    assert.deepEqual(globalError(new ApiError(409, "TEST unrelated message", "CONFLICT", { reason })),
      { code: reason, statusCode: 409 })
  })

  test(`global errors recognize ${reason} as a top-level failure code`, () => {
    assert.deepEqual(globalError(new ApiError(409, "TEST unrelated message", reason)),
      { code: reason, statusCode: 409 })
  })
}

test("pnpm error copy cannot turn an unknown or malformed reason into a supported code", () => {
  for (const details of [{ reason: "TEST_FUTURE_REASON" }, { reason: null }, { reason: 11 }]) {
    assert.deepEqual(globalError(new ApiError(409, "PNPM_GLOBAL_NOT_CONFIGURED", "GLOBAL_GROUP_UNSUPPORTED", details)),
      { code: "UNKNOWN", statusCode: 409 })
  }
  assert.deepEqual(globalError(new ApiError(409, "GLOBAL_GROUP_UNSUPPORTED", "TEST_FUTURE_REASON")),
    { code: "UNKNOWN", statusCode: 409 })
})

test("global errors use codes/reasons only; unknown reason never becomes a display key", () => {
  for (const reason of ["RUNNING", "PREVIEW_CHANGED", "PREVIEW_EXPIRED", "PREVIEW_CONSUMED", "REQUEST_MISMATCH", "PROTECTED_PACKAGE", "REGISTRY_CONFIG_UNSUPPORTED", "POSTCONDITION_FAILED", "MANAGER_DISABLED"]) {
    assert.deepEqual(globalError(new ApiError(409, "TEST arbitrary message", "CONFLICT", { reason })), { code: reason, statusCode: 409 })
  }
  for (const details of [{ reason: "TEST_FUTURE_REASON" }, { reason: {} }]) {
    assert.deepEqual(globalError(new ApiError(409, "RUNNING", "CONFLICT", details)), { code: "UNKNOWN", statusCode: 409 })
  }
  assert.deepEqual(globalError(new ApiError(403, "PREVIEW_EXPIRED", "FORBIDDEN")), { code: "FORBIDDEN", statusCode: 403 })
  assert.deepEqual(globalError(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE")), { code: "BACKEND_UNAVAILABLE", statusCode: 503 })
  assert.deepEqual(globalError(new Error("PREVIEW_CHANGED")), { code: "UNKNOWN" })
})
