import { test } from "node:test"
import assert from "node:assert/strict"
import { DEPENDENCY_DISCOVERY, ADVISORY_DISCOVERY, dependencyDiscoveryCodec, advisoryDiscoveryCodec } from "./detail-discovery-state.ts"
test("detail control codecs preserve multi-choice filters and reject scalar, unknown, duplicate or mutation fields", () => {
  const dependency = { ...DEPENDENCY_DISCOVERY, query: "TEST", groups: ["dependencies", "devDependencies"], statuses: ["outdated", "unchecked"], sort: "status" }
  assert.deepEqual(dependencyDiscoveryCodec.decode(dependency), dependency)
  for (const patch of [{ groups: "dependencies" }, { statuses: ["clean"] }, { groups: ["dependencies", "dependencies"] },
    { query: "x".repeat(513) }, { preview: {} }, { sort: "unknown" }]) {
    assert.equal(dependencyDiscoveryCodec.decode({ ...dependency, ...patch }), null)
  }
  const advisory = { ...ADVISORY_DISCOVERY, severities: ["unknown", "critical"], exposures: ["direct", "transitive"] }
  assert.deepEqual(advisoryDiscoveryCodec.decode(advisory), advisory)
  assert.equal(advisoryDiscoveryCodec.decode({ ...advisory, exposures: ["fixable"] }), null)
  assert.deepEqual(dependencyDiscoveryCodec.decode(DEPENDENCY_DISCOVERY), DEPENDENCY_DISCOVERY)
})
