import { test } from "node:test"
import assert from "node:assert/strict"
import { createDiscoveryCodec, isEnumArray, textDiscoveryCodec } from "./discovery-state.ts"

test("view codecs accept only bounded text and explicit enum arrays, reject extra mutation state", () => {
  const codec = createDiscoveryCodec({ query: "", kinds: [] }, raw => isEnumArray(raw.kinds, ["file", "directory"]))
  for (const value of [null, {}, { query: "x".repeat(513), kinds: [] }, { query: "", kinds: ["bad"] },
    { query: "", kinds: ["file", "file"] }, { query: "", kinds: [], selected: ["TEST"] }]) assert.equal(codec.decode(value), null)
  const input = { query: "TEST", kinds: ["directory", "file"] }
  assert.deepEqual(codec.decode(input), input)
  const encoded = codec.encode(input)
  encoded.kinds.push("TEST")
  assert.deepEqual(input.kinds, ["directory", "file"])
  assert.deepEqual(textDiscoveryCodec.decode({ query: "" }), { query: "" })
})
