import { test } from "node:test"
import assert from "node:assert/strict"
import { computeGlobalManagerMetrics } from "./global-metrics.ts"

// Dữ liệu TEST trong file này không phải yêu cầu nghiệp vụ.
test("computeGlobalManagerMetrics categorizes manageable, protected/linked, and invalid global packages", () => {
  const inventory = {
    manager: "npm",
    version: "11.17.0",
    available: true,
    reason: null,
    globalRoot: "C:\\TEST\\npm\\node_modules",
    binDir: "C:\\TEST\\npm",
    packages: [
      { name: "TEST-a", version: "1.0.0", bins: [], status: "manageable", reason: null },
      { name: "TEST-b", version: "2.0.0", bins: [], status: "manageable", reason: "BIN_CONFLICT" },
      { name: "npm", version: "11.17.0", bins: [], status: "protected", reason: "PROTECTED_PACKAGE" },
      { name: "TEST-link", version: "0.1.0", bins: [], status: "linked", reason: "LINKED_PACKAGE" },
      { name: "TEST-bad", version: "0.0.0", bins: [], status: "invalid", reason: "INVENTORY_FAILED" },
    ],
  }

  assert.deepEqual(computeGlobalManagerMetrics(inventory), {
    totalCount: 5,
    manageableCount: 1,
    protectedOrLinkedCount: 2,
    invalidCount: 2,
    available: true,
    version: "11.17.0",
  })
})

test("computeGlobalManagerMetrics handles unavailable manager with empty package list", () => {
  const inventory = {
    manager: "pnpm",
    version: null,
    available: false,
    reason: "TOOL_NOT_FOUND",
    globalRoot: null,
    binDir: null,
    packages: [],
  }

  assert.deepEqual(computeGlobalManagerMetrics(inventory), {
    totalCount: 0,
    manageableCount: 0,
    protectedOrLinkedCount: 0,
    invalidCount: 0,
    available: false,
    version: null,
  })
})
