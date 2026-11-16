import { test } from "node:test"
import assert from "node:assert/strict"
import {
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_OUTPUT_MAX_BYTES,
  TERMINAL_OUTPUT_MAX_CHUNKS,
  clampTerminalSize,
  findTerminalOutputMatches,
  initialTerminalClientState,
  initialTerminalOutput,
  isValidTerminalInputText,
  mergeTerminalOutput,
  needsTerminalOutputDrain,
  needsTerminalPasteConfirmation,
  resolveTerminalCtrlC,
  terminalOutputText,
} from "./terminal-session.ts"

// TEST data; không phải yêu cầu nghiệp vụ.
const jobId = "00000000-0000-4000-8000-000000000001"
const tabId = "00000000-0000-4000-8000-000000000011"

test("mergeTerminalOutput appends ordered chunks and handles parserReset/gap without fabricating history", () => {
  let out = initialTerminalOutput(jobId, 1)
  out = mergeTerminalOutput(out, {
    jobId,
    generation: 1,
    firstCursor: 0,
    nextCursor: 6,
    endCursor: 6,
    gap: false,
    truncated: false,
    parserReset: false,
    droppedBytes: 0,
    chunks: [{ cursor: 0, endCursor: 6, text: "hello\n" }],
  })
  assert.equal(terminalOutputText(out), "hello\n")
  assert.equal(out.resetRevision, 0)

  // Gap forces parserReset and replaces old retained tail cleanly
  out = mergeTerminalOutput(out, {
    jobId,
    generation: 1,
    firstCursor: 100,
    nextCursor: 106,
    endCursor: 110,
    gap: true,
    truncated: true,
    parserReset: true,
    droppedBytes: 100,
    chunks: [{ cursor: 100, endCursor: 106, text: "world\n" }],
  })
  assert.equal(out.resetRevision, 1)
  assert.equal(out.cursor, 106)
  assert.equal(out.truncated, true)
  assert.equal(out.droppedBytes, 100)
  assert.equal(terminalOutputText(out), "world\n")
  assert.equal(
    needsTerminalOutputDrain(out, {
      jobId,
      terminal: {
        mode: "pty",
        generation: 1,
        available: true,
        ready: true,
        firstCursor: 100,
        endCursor: 110,
        droppedBytes: 100,
        writerGeneration: 1,
        inputBlocked: false,
      },
    }),
    true,
  )
})

test("mergeTerminalOutput enforces 1MiB / 4096-chunk bounds and rejects mismatched job/generation/cursor", () => {
  let out = initialTerminalOutput(jobId, 1)
  assert.throws(
    () => mergeTerminalOutput(out, {
      jobId: "00000000-0000-4000-8000-000000000099",
      generation: 1,
      firstCursor: 0,
      nextCursor: 0,
      endCursor: 0,
      gap: false,
      truncated: false,
      parserReset: false,
      droppedBytes: 0,
      chunks: [],
    }),
    { code: "INVALID_RESPONSE" },
  )

  // Exceed 1MiB cap across multiple chunks
  const bigChunk = "a".repeat(300 * 1024)
  for (let i = 0; i < 5; i++) {
    const start = i * bigChunk.length
    const end = start + bigChunk.length
    out = mergeTerminalOutput(out, {
      jobId,
      generation: 1,
      firstCursor: 0,
      nextCursor: end,
      endCursor: end,
      gap: false,
      truncated: false,
      parserReset: false,
      droppedBytes: 0,
      chunks: [{ cursor: start, endCursor: end, text: bigChunk }],
    })
  }
  assert.ok(Buffer.byteLength(terminalOutputText(out), "utf8") <= TERMINAL_OUTPUT_MAX_BYTES)
  assert.ok(out.chunks.length <= TERMINAL_OUTPUT_MAX_CHUNKS)
  assert.ok(out.localDroppedBytes > 0)
})

test("search, paste confirmation, Ctrl+C selection policy, input size and resize validation", () => {
  const search = findTerminalOutputMatches("Line 1: ERR\nLine 2: ok\nLine 3: err here", "ERR")
  assert.equal(search.count, 2)
  assert.deepEqual(search.matches.map(m => m.line), [1, 3])
  assert.equal(findTerminalOutputMatches("abc", "   ").count, 0)

  assert.equal(needsTerminalPasteConfirmation("npm test"), false)
  assert.equal(needsTerminalPasteConfirmation("npm test\necho hi"), true)
  assert.equal(needsTerminalPasteConfirmation("npm test\recho hi"), true)

  assert.equal(resolveTerminalCtrlC(true), "copy")
  assert.equal(resolveTerminalCtrlC(false), "interrupt")

  assert.equal(isValidTerminalInputText(""), false)
  assert.equal(isValidTerminalInputText("y\r"), true)
  assert.equal(isValidTerminalInputText("x".repeat(TERMINAL_INPUT_MAX_BYTES + 1)), false)

  assert.deepEqual(clampTerminalSize(80, 24), { cols: 80, rows: 24 })
  assert.equal(clampTerminalSize(1, 24), null)
  assert.equal(clampTerminalSize(501, 24), null)
  assert.equal(clampTerminalSize(80, 0), null)
  assert.equal(clampTerminalSize(80, 301), null)

  const client = initialTerminalClientState(tabId, jobId, 1)
  assert.equal(client.tabId, tabId)
  assert.equal(client.nextSequence, 1)
  assert.equal(client.inputUnknown, false)
})
