import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DISMISSED_GLOBAL_PREVIEWS_KEY,
  DISMISSED_GLOBAL_PREVIEWS_MAX,
  createDismissedPreviewTracker,
} from "./global-dismissed-previews.ts"

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null },
    setItem(key, value) { map.set(key, value) },
    raw(key) { return map.get(key) ?? null },
  }
}

test("records and checks preview IDs while ignoring null, undefined, and empty strings", () => {
  const tracker = createDismissedPreviewTracker({ storage: null })
  assert.equal(DISMISSED_GLOBAL_PREVIEWS_MAX, 32)
  assert.equal(tracker.has(null), false)
  assert.equal(tracker.has(undefined), false)
  assert.equal(tracker.has(""), false)
  assert.equal(tracker.has("   "), false)

  tracker.add(null)
  tracker.add(undefined)
  tracker.add("")
  tracker.add("   ")
  assert.equal(tracker.has(""), false)

  tracker.add("preview-1")
  assert.equal(tracker.has("preview-1"), true)
  assert.equal(tracker.has("preview-2"), false)
})

test("persists dismissed preview IDs to storage and rehydrates into a fresh tracker", () => {
  const storage = memoryStorage()
  const first = createDismissedPreviewTracker({ storage })
  first.add("preview-a")
  first.add("preview-b")

  const raw = storage.raw(DISMISSED_GLOBAL_PREVIEWS_KEY)
  assert.deepEqual(JSON.parse(raw), ["preview-a", "preview-b"])

  const rehydrated = createDismissedPreviewTracker({ storage })
  assert.equal(rehydrated.has("preview-a"), true)
  assert.equal(rehydrated.has("preview-b"), true)
  assert.equal(rehydrated.has("preview-c"), false)
})

test("enforces maxEntries LRU/FIFO cap and refreshes recency on duplicate add", () => {
  const storage = memoryStorage()
  const tracker = createDismissedPreviewTracker({ storage, maxEntries: 3 })
  tracker.add("p1")
  tracker.add("p2")
  tracker.add("p3")
  tracker.add("p1") // p1 becomes most recent; oldest is now p2
  tracker.add("p4")

  assert.equal(tracker.has("p1"), true)
  assert.equal(tracker.has("p2"), false)
  assert.equal(tracker.has("p3"), true)
  assert.equal(tracker.has("p4"), true)
  assert.deepEqual(JSON.parse(storage.raw(DISMISSED_GLOBAL_PREVIEWS_KEY)), ["p3", "p1", "p4"])
})

test("ignores corrupt JSON, non-array payloads, and invalid elements in storage", () => {
  const badPayloads = [
    "{not valid json",
    JSON.stringify({ previewId: "p1" }),
    JSON.stringify("p1"),
    JSON.stringify([123, null, "", "   ", "valid-1", "valid-2"]),
  ]
  for (const payload of badPayloads) {
    const storage = memoryStorage({ [DISMISSED_GLOBAL_PREVIEWS_KEY]: payload })
    const tracker = createDismissedPreviewTracker({ storage, maxEntries: 2 })
    if (payload.includes("valid-1")) {
      assert.equal(tracker.has("valid-1"), true)
      assert.equal(tracker.has("valid-2"), true)
    } else {
      assert.equal(tracker.has("p1"), false)
    }
  }
})

test("falls back gracefully to in-memory tracking when storage throws", () => {
  const throwingStorage = {
    getItem() { throw new Error("TEST blocked read") },
    setItem() { throw new Error("TEST blocked write") },
  }
  const tracker = createDismissedPreviewTracker({ storage: throwingStorage })
  tracker.add("p-in-memory")
  assert.equal(tracker.has("p-in-memory"), true)
  assert.equal(tracker.has("other"), false)
})
