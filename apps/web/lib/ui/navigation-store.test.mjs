import { test } from "node:test"
import assert from "node:assert/strict"
import {
  NAV_MAX_BYTES,
  NAV_MAX_ENTRIES,
  NAV_STORAGE_KEY,
  createNavigationStore,
} from "./navigation-store.ts"
import { createTextCodec, makeViewStateKey } from "./navigation-targets.ts"

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: (key) => { map.delete(key) },
    raw: map,
  }
}

const jsonCodec = (version = 1) => ({
  version,
  encode: (value) => value,
  decode: (raw) => (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : null),
})

test("hydrated store reads/writes typed entries, preserves referential stability, and isolates corrupt/obsolete entries", () => {
  let time = 100
  const storage = memoryStorage({
    [NAV_STORAGE_KEY]: JSON.stringify({
      v: 1,
      entries: {
        "valid::a": { v: 1, t: 10, d: "alpha" },
        "stale::b": { v: 1, t: 11, d: "old" },
        "corrupt::c": { v: 1, t: 12, d: 42 },
      },
      scrolls: {},
    }),
  })
  const store = createNavigationStore({ storage, now: () => ++time })
  store.hydrate()

  const textV1 = createTextCodec(1)
  const textV2 = createTextCodec(2)

  assert.equal(store.readViewState("valid::a", textV1), "alpha")
  assert.equal(store.readViewState("stale::b", textV2), null)
  assert.equal(store.readViewState("corrupt::c", textV1), null)
  // Valid sibling survived reset of stale/corrupt entries.
  assert.equal(store.readViewState("valid::a", textV1), "alpha")

  const objCodec = jsonCodec(1)
  store.writeViewState("obj::1", objCodec, { q: "react" })
  const firstRef = store.readViewState("obj::1", objCodec)
  const secondRef = store.readViewState("obj::1", objCodec)
  assert.equal(firstRef, secondRef)
})

test("corrupt outer JSON and failing storage degrade cleanly to in-memory continuity", () => {
  const corruptStorage = memoryStorage({ [NAV_STORAGE_KEY]: "{not-json" })
  const storeA = createNavigationStore({ storage: corruptStorage })
  assert.doesNotThrow(() => storeA.hydrate())
  assert.equal(storeA.readViewState("k", createTextCodec(1)), null)

  const throwingStorage = {
    getItem() { throw new Error("blocked") },
    setItem() { throw new Error("QuotaExceededError") },
    removeItem() { throw new Error("blocked") },
  }
  const storeB = createNavigationStore({ storage: throwingStorage })
  assert.doesNotThrow(() => storeB.hydrate())
  assert.doesNotThrow(() => storeB.writeViewState("k", createTextCodec(1), "kept-in-mem"))
  assert.equal(storeB.readViewState("k", createTextCodec(1)), "kept-in-mem")
})

test("store caps persisted entries at 128 and serialized bytes at 128KiB via LRU eviction", () => {
  let time = 0
  const storage = memoryStorage()
  const store = createNavigationStore({ storage, now: () => ++time })
  store.hydrate()
  const codec = createTextCodec(1, 2048)

  for (let i = 0; i < NAV_MAX_ENTRIES + 12; i++) {
    store.writeViewState(makeViewStateKey("test", String(i)), codec, `v-${i}`)
  }
  const parsedAfterCount = JSON.parse(storage.raw.get(NAV_STORAGE_KEY))
  assert.equal(Object.keys(parsedAfterCount.entries).length, NAV_MAX_ENTRIES)
  assert.equal(store.readViewState(makeViewStateKey("test", "0"), codec), null)
  assert.equal(store.readViewState(makeViewStateKey("test", String(NAV_MAX_ENTRIES + 11)), codec), `v-${NAV_MAX_ENTRIES + 11}`)

  // Byte budget eviction (128KiB)
  const big = "b".repeat(2048)
  for (let i = 0; i < 80; i++) {
    store.writeViewState(makeViewStateKey("big", String(i)), codec, big)
  }
  const raw = storage.raw.get(NAV_STORAGE_KEY)
  assert.ok(new TextEncoder().encode(raw).byteLength <= NAV_MAX_BYTES)
})

test("store blocks forbidden keys (previews, confirmations, logs, stdin, secrets) from sessionStorage", () => {
  const storage = memoryStorage()
  const store = createNavigationStore({ storage })
  store.hydrate()
  const unsafeCodec = jsonCodec(1)

  for (const field of ["previewId", "confirmText", "acknowledgedRisks", "logs", "stdin", "token", "operationId"]) {
    store.writeViewState(`bad::${field}`, unsafeCodec, { query: "ok", nested: { [field]: "secret-or-pc" } })
    const raw = storage.raw.get(NAV_STORAGE_KEY)
    assert.equal(raw?.includes(field) ?? false, false, `forbidden key ${field} must not persist`)
  }
})

test("memory snapshots stay out of sessionStorage and invalidate on bumpMutationEpoch", () => {
  const storage = memoryStorage()
  const store = createNavigationStore({ storage, maxMemorySnapshots: 3 })
  store.hydrate()

  store.setSnapshot("disk::1", { size: 100 })
  assert.equal(storage.raw.get(NAV_STORAGE_KEY), undefined)
  assert.deepEqual(store.getSnapshotRecord("disk::1")?.value, { size: 100 })
  assert.equal(store.getSnapshotRecord("disk::1")?.invalid, false)

  store.bumpMutationEpoch("file-ops")
  const afterMutation = store.getSnapshotRecord("disk::1")
  assert.equal(afterMutation?.invalid, true)

  // Bounded capacity evicts oldest snapshot
  store.setSnapshot("disk::2", { size: 2 })
  store.setSnapshot("disk::3", { size: 3 })
  store.setSnapshot("disk::4", { size: 4 })
  assert.equal(store.getSnapshotRecord("disk::1"), null)
  assert.deepEqual(store.getSnapshotRecord("disk::4")?.value, { size: 4 })
  assert.equal(store.getSnapshotRecord("disk::4")?.invalid, false)
})

test("per-entry scroll isolation and one-shot pending return scroll work across Back/Forward", () => {
  let time = 0
  const storage = memoryStorage()
  const store = createNavigationStore({ storage, now: () => ++time })
  store.hydrate()

  store.setScroll("entry-1", "projects::", { x: 0, y: 640 })
  store.setScroll("entry-2", "projects::", { x: 0, y: 120 })
  assert.deepEqual(store.getScroll("entry-1", "projects::"), { x: 0, y: 640 })
  assert.deepEqual(store.getScroll("entry-2", "projects::"), { x: 0, y: 120 })

  store.setPendingReturnScroll("/?q=next", "entry-1")
  assert.equal(store.consumePendingReturnScroll("/?q=next"), "entry-1")
  assert.equal(store.consumePendingReturnScroll("/?q=next"), null)
})
