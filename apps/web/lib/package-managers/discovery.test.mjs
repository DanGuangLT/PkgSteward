import { test } from "node:test"
import assert from "node:assert/strict"
import { VERSION_DISCOVERY, versionDiscoveryCodec, selectManagerVersions } from "./discovery.ts"
test("version filters intersect real support/deprecation with tags, keeping selected hidden target", () => {
  const active = { version: "2.0.0", supported: true, deprecated: false, reason: null }
  const deprecated = { version: "1.0.0", supported: true, deprecated: true, reason: null }
  const unsupported = { version: "3.0.0", supported: false, deprecated: false, reason: "TEST" }
  const rows = Object.freeze([active, deprecated, unsupported])
  const result = selectManagerVersions(rows, { query: " LATEST ", support: ["supported", "unsupported"], deprecation: ["active"] }, { latest: "3.0.0" }, deprecated.version)
  assert.deepEqual(result.matches, [unsupported])
  assert.deepEqual(result.options, [deprecated, unsupported])
  assert.equal(result.selectedHidden, true)
  assert.deepEqual(selectManagerVersions(rows, VERSION_DISCOVERY, {}, "").matches, [active, deprecated])
  assert.equal(versionDiscoveryCodec.decode({ ...VERSION_DISCOVERY, support: ["invented"] }), null)
})
