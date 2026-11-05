import { test } from "node:test"
import assert from "node:assert/strict"
import { revealRegion } from "./reveal-region.ts"

// TEST doubles; không phải yêu cầu nghiệp vụ. No browser or scrolling required.
for (const reducedMotion of [false, true]) {
  test(`reveals and focuses the region with reducedMotion=${reducedMotion}`, () => {
    const calls = []
    const target = {
      scrollIntoView(options) { calls.push(["scroll", options]) },
      focus(options) { calls.push(["focus", options]) },
    }

    revealRegion(target, { reducedMotion })

    assert.deepEqual(calls, [
      ["scroll", { block: "start", behavior: reducedMotion ? "auto" : "smooth" }],
      ["focus", { preventScroll: true }],
    ])
  })
}

test("a missing region is a no-op", () => {
  assert.doesNotThrow(() => revealRegion(null, { reducedMotion: false }))
  assert.doesNotThrow(() => revealRegion(null, { reducedMotion: true }))
})
