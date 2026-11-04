import { test } from "node:test"
import assert from "node:assert/strict"
import { ApiError } from "../api/response.ts"
import { globalError } from "./global-types.ts"

test("global errors use codes/reasons only; unknown reason never becomes a display key", () => {
  for (const reason of ["RUNNING", "PREVIEW_CHANGED", "PREVIEW_EXPIRED", "PREVIEW_CONSUMED", "REQUEST_MISMATCH", "PROTECTED_PACKAGE", "REGISTRY_CONFIG_UNSUPPORTED", "POSTCONDITION_FAILED"]) {
    assert.deepEqual(globalError(new ApiError(409, "TEST arbitrary message", "CONFLICT", { reason })), { code: reason, statusCode: 409 })
  }
  for (const details of [{ reason: "TEST_FUTURE_REASON" }, { reason: {} }]) {
    assert.deepEqual(globalError(new ApiError(409, "RUNNING", "CONFLICT", details)), { code: "UNKNOWN", statusCode: 409 })
  }
  assert.deepEqual(globalError(new ApiError(403, "PREVIEW_EXPIRED", "FORBIDDEN")), { code: "FORBIDDEN", statusCode: 403 })
  assert.deepEqual(globalError(new ApiError(503, "TEST", "BACKEND_UNAVAILABLE")), { code: "BACKEND_UNAVAILABLE", statusCode: 503 })
  assert.deepEqual(globalError(new Error("PREVIEW_CHANGED")), { code: "UNKNOWN" })
})
