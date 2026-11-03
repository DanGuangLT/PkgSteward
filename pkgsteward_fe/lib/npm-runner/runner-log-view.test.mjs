import { test } from "node:test"
import assert from "node:assert/strict"
import { initialRunnerLogs, mergeRunnerLogs, isNearLogBottom, shouldAutoscroll, jumpToLatest, needsLogDrain } from "./runner-log-view.ts"

// TEST data; không phải yêu cầu nghiệp vụ.
const chunk = (seq, text = "TEST", stream = "stdout") => ({ seq, text, stream })
const page = (chunks, overrides = {}) => ({ jobId: "TEST-job", firstCursor: 0, nextCursor: chunks.at(-1)?.seq + 1 || 0, endCursor: chunks.at(-1)?.seq + 1 || 0, truncated: false, droppedBytes: 0, chunks, ...overrides })

test("merges sorted seq once, isolates old jobs, counts gaps without resurrecting evicted output", () => {
  const initial = initialRunnerLogs("TEST-job")
  const first = mergeRunnerLogs(initial, page([chunk(1), chunk(0), chunk(1)], { nextCursor: 2 }))
  assert.deepEqual(first.chunks.map(c => c.seq), [0, 1])
  assert.equal(first.cursor, 2)
  assert.deepEqual(mergeRunnerLogs(first, page([chunk(1)], { nextCursor: 2 })), first)
  assert.equal(mergeRunnerLogs(first, page([chunk(3)], { jobId: "TEST-old" })), first)
  const gap = mergeRunnerLogs(first, page([chunk(5)], { firstCursor: 5, nextCursor: 6, truncated: true, droppedBytes: 80 }))
  assert.equal(gap.droppedChunks, 3)
  assert.equal(gap.serverDroppedBytes, 80)
  assert.equal(mergeRunnerLogs(gap, page([chunk(5)], { firstCursor: 5, nextCursor: 6, truncated: true, droppedBytes: 80 })).droppedChunks, 3)
  assert.equal(initial.chunks.length, 0)
})

test("UTF8 byte cap and chunk cap apply independently; dropped counts stay visible", () => {
  const chunks = Array.from({ length: 2055 }, (_, i) => chunk(i, "TEST"))
  const capped = mergeRunnerLogs(initialRunnerLogs("TEST-job"), page(chunks))
  assert.equal(capped.chunks.length, 2048)
  assert.equal(capped.droppedChunks, 7)
  const unicode = Array.from({ length: 100 }, (_, i) => chunk(i, "😀".repeat(2048)))
  const bytes = mergeRunnerLogs(initialRunnerLogs("TEST-job"), page(unicode))
  assert.equal(bytes.bytes, 512 * 1024)
  assert.equal(bytes.chunks.length, 64)
  assert.equal(bytes.localDroppedBytes, 36 * 8192)
  assert.equal(bytes.droppedChunks, 36)
})

test("HTML/OSC/stderr stays exact inert text; no parsing/linkification", () => {
  const text = '<script>TEST</script>\x1b]8;;https://TEST\x07click\x1b]8;;\x07'
  const logs = mergeRunnerLogs(initialRunnerLogs("TEST-job"), page([chunk(0, text, "stderr")]))
  assert.deepEqual(logs.chunks, [chunk(0, text, "stderr")])
})

test("autoscroll uses pre-update distance <=24px, scrolling up pauses and Jump resumes", () => {
  assert.equal(isNearLogBottom({ scrollHeight: 1000, scrollTop: 476, clientHeight: 500 }), true)
  assert.equal(isNearLogBottom({ scrollHeight: 1000, scrollTop: 475, clientHeight: 500 }), false)
  assert.equal(shouldAutoscroll(false, { scrollHeight: 1000, scrollTop: 0, clientHeight: 500 }), false)
  assert.equal(shouldAutoscroll(true, { scrollHeight: 1000, scrollTop: 475, clientHeight: 500 }), false)
  assert.deepEqual(jumpToLatest(), { following: true, scrollToBottom: true })
  assert.equal(needsLogDrain({ cursor: 4 }, { endCursor: 5 }), true)
  assert.equal(needsLogDrain({ cursor: 5 }, { endCursor: 5 }), false)
})
