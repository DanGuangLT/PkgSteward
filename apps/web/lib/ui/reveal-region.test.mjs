import { test } from "node:test"
import assert from "node:assert/strict"
import { restoreOrReveal, revealRegion } from "./reveal-region.ts"

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

for (const reducedMotion of [false, true]) {
  test(`restoreOrReveal reveals the region when the return target is gone (reducedMotion=${reducedMotion})`, () => {
    const calls = []
    const back = { isConnected: false, matches: () => false, focus() { calls.push(["back"]) } }
    const region = {
      scrollIntoView(options) { calls.push(["scroll", options]) },
      focus(options) { calls.push(["focus", options]) },
    }

    restoreOrReveal(back, region, { reducedMotion })

    assert.deepEqual(calls, [
      ["scroll", { block: "start", behavior: reducedMotion ? "auto" : "smooth" }],
      ["focus", { preventScroll: true }],
    ])
  })
}

test("restoreOrReveal returns focus to a connected target without touching the region", () => {
  const calls = []
  const back = { isConnected: true, matches: () => false, focus(...args) { calls.push(["back", ...args]) } }
  const region = {
    scrollIntoView() { calls.push(["scroll"]) },
    focus() { calls.push(["region"]) },
  }

  restoreOrReveal(back, region, { reducedMotion: false })

  assert.deepEqual(calls, [["back"]])
})

test("restoreOrReveal reveals the region when there is no return target", () => {
  const calls = []
  const region = {
    scrollIntoView() { calls.push(["scroll"]) },
    focus() { calls.push(["region"]) },
  }

  restoreOrReveal(null, region, { reducedMotion: true })

  assert.deepEqual(calls, [["scroll"], ["region"]])
})

test("restoreOrReveal reveals the region when the return target is disabled", () => {
  const calls = []
  const back = { isConnected: true, matches: (selector) => selector === ":disabled", focus() { calls.push(["back"]) } }
  const region = {
    scrollIntoView() { calls.push(["scroll"]) },
    focus() { calls.push(["region"]) },
  }

  restoreOrReveal(back, region, { reducedMotion: false })

  assert.deepEqual(calls, [["scroll"], ["region"]])
})

test("restoreOrReveal is a no-op when both targets are missing", () => {
  assert.doesNotThrow(() => restoreOrReveal(null, null, { reducedMotion: false }))
})
