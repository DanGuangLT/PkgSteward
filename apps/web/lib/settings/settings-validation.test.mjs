import { test } from "node:test"
import assert from "node:assert/strict"
import {
  parseImportSettingsJson,
  validateMaxDepthInput,
  validateScanRootInput,
  validateServerDraft,
  validateTimeoutInput,
} from "./settings-validation.ts"

test("validateScanRootInput accepts Windows/POSIX absolute paths and rejects relative/mixed wildcards", () => {
  assert.equal(validateScanRootInput("D:\\Projects"), null)
  assert.equal(validateScanRootInput("D:\\Projects, E:\\Work"), null)
  assert.equal(validateScanRootInput("/home/user/projects"), null)
  assert.equal(validateScanRootInput("relative/dir"), "SCAN_ROOTS_ABSOLUTE")
  assert.equal(validateScanRootInput("D:\\Projects, relative"), "SCAN_ROOTS_ABSOLUTE")
  assert.equal(validateScanRootInput("D:\\Projects\\*"), "SCAN_ROOTS_WILDCARD")
  assert.equal(validateScanRootInput("D:\\Projects, *"), "SCAN_ROOTS_WILDCARD")
})

test("validateTimeoutInput and validateMaxDepthInput enforce integer bounds", () => {
  assert.equal(validateTimeoutInput(false, "10"), null)
  assert.equal(validateTimeoutInput(true, "1000"), null)
  assert.equal(validateTimeoutInput(true, "999"), "TIMEOUT_MIN_1000")
  assert.equal(validateMaxDepthInput("0"), null)
  assert.equal(validateMaxDepthInput("21"), "DEPTH_RANGE")
})

test("validateServerDraft enforces loopback host, port range, and safe CORS origins", () => {
  assert.equal(
    validateServerDraft({
      host: "127.0.0.1",
      port: "24681",
      globalPrefix: "api",
      version: "1",
      listOriginCors: "http://localhost:24680, http://127.0.0.1:24680",
    }),
    null
  )
  assert.equal(
    validateServerDraft({
      host: "0.0.0.0",
      port: "24681",
      globalPrefix: "api",
      version: "1",
      listOriginCors: "http://localhost:24680",
    }),
    "SERVER_HOST"
  )
  assert.equal(
    validateServerDraft({
      host: "localhost",
      port: "24681",
      globalPrefix: "api",
      version: "1",
      listOriginCors: "*",
    }),
    "SERVER_CORS"
  )
})

test("parseImportSettingsJson rejects arrays/primitives and accepts UTF-8 BOM objects", () => {
  assert.equal(parseImportSettingsJson("[1,2,3]").ok, false)
  assert.equal(parseImportSettingsJson("{oops").ok, false)
  const parsed = parseImportSettingsJson('\uFEFF{"schemaVersion":1}')
  assert.equal(parsed.ok, true)
})
