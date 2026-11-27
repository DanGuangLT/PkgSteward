import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const REPO_ROOT = resolve(import.meta.dirname, "../../../..")
const WEB_ROOT = resolve(REPO_ROOT, "apps/web")
const ASSETS_DIR = resolve(REPO_ROOT, ".github/assets")

function readPngHeader(buf) {
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "valid PNG signature")
  const ihdrLen = buf.readUInt32BE(8)
  assert.equal(ihdrLen, 13, "IHDR length")
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR")
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf.readUInt8(24),
    colorType: buf.readUInt8(25),
  }
}

test("app/icon.svg matches .github/assets/logo.svg and uses new 3-color brand mark", () => {
  const assetSvg = readFileSync(resolve(ASSETS_DIR, "logo.svg"), "utf8")
  const appSvg = readFileSync(resolve(WEB_ROOT, "app/icon.svg"), "utf8")

  assert.equal(appSvg, assetSvg)
  assert.match(appSvg, /viewBox="0 0 512 512"/)
  assert.match(appSvg, /fill="#d92a2f"/)
  assert.match(appSvg, /fill="#ffffff"/)
  assert.match(appSvg, /fill="#111111"/)
  assert.doesNotMatch(appSvg, /#e60023/i)
  assert.doesNotMatch(appSvg, /stroke-width="40"/)
})

test("wordmark SVGs are pure vector outlines with light and dark Steward ink", () => {
  const lightSvg = readFileSync(resolve(ASSETS_DIR, "logo-wordmark.svg"), "utf8")
  const darkSvg = readFileSync(resolve(ASSETS_DIR, "logo-wordmark-dark.svg"), "utf8")

  for (const svg of [lightSvg, darkSvg]) {
    assert.doesNotMatch(svg, /<text\b/i)
    assert.match(svg, /viewBox="0 0 \d+ 144"/)
    const gCloseIdx = svg.indexOf("</g>")
    assert.notEqual(gCloseIdx, -1)
    assert.match(svg.slice(0, gCloseIdx), /fill="#111111"/)
    assert.match(svg.slice(gCloseIdx), /fill="#d92a2f"/)
  }

  const lightTail = lightSvg.slice(lightSvg.indexOf("</g>"))
  const darkTail = darkSvg.slice(darkSvg.indexOf("</g>"))
  assert.match(lightTail, /fill="#111111"/)
  assert.match(darkTail, /fill="#f5f5f5"/)
  assert.doesNotMatch(darkTail, /fill="#111111"/)
})

test("binary brand assets and favicons have expected dimensions and formats", () => {
  const logoPng = readPngHeader(readFileSync(resolve(ASSETS_DIR, "logo.png")))
  assert.deepEqual(logoPng, { width: 512, height: 512, bitDepth: 8, colorType: 6 })

  const wordmarkPng = readPngHeader(readFileSync(resolve(ASSETS_DIR, "logo-wordmark.png")))
  assert.equal(wordmarkPng.height, 288)
  assert.equal(wordmarkPng.bitDepth, 8)
  assert.equal(wordmarkPng.colorType, 6)
  assert.ok(wordmarkPng.width >= 1200)

  const applePng = readPngHeader(readFileSync(resolve(WEB_ROOT, "app/apple-icon.png")))
  assert.deepEqual(applePng, { width: 180, height: 180, bitDepth: 8, colorType: 2 })

  const ico = readFileSync(resolve(WEB_ROOT, "app/favicon.ico"))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 3)
  const sizes = []
  for (let i = 0; i < 3; i++) {
    const base = 6 + i * 16
    const w = ico.readUInt8(base) || 256
    const h = ico.readUInt8(base + 1) || 256
    const bpp = ico.readUInt16LE(base + 6)
    const size = ico.readUInt32LE(base + 8)
    const offset = ico.readUInt32LE(base + 12)
    sizes.push([w, h])
    assert.equal(bpp, 32)
    const entryPng = readPngHeader(ico.subarray(offset, offset + size))
    assert.deepEqual([entryPng.width, entryPng.height], [w, h])
  }
  assert.deepEqual(sizes, [
    [16, 16],
    [32, 32],
    [48, 48],
  ])
})

test("Logo and BrandWordmark components use semantic tokens and no hardcoded hex literals", () => {
  const logoTsx = readFileSync(resolve(WEB_ROOT, "components/layout/logo.tsx"), "utf8")
  const defaultCss = readFileSync(resolve(WEB_ROOT, "styles/themes/default.css"), "utf8")
  const tokensCss = readFileSync(resolve(WEB_ROOT, "styles/tokens.css"), "utf8")

  assert.match(logoTsx, /export function Logo\b/)
  assert.match(logoTsx, /export function BrandWordmark\b/)
  assert.match(logoTsx, /fill-logo-surface/)
  assert.match(logoTsx, /fill-logo-cube/)
  assert.match(logoTsx, /fill-logo-cradle/)
  assert.doesNotMatch(logoTsx, /#[0-9a-f]{3,8}\b/i)

  assert.match(defaultCss, /--logo-surface:\s*#d92a2f;/)
  assert.match(defaultCss, /--logo-cube:\s*#ffffff;/)
  assert.match(defaultCss, /--logo-cradle:\s*#111111;/)
  assert.match(tokensCss, /--color-logo-surface:\s*var\(--logo-surface\);/)
  assert.match(tokensCss, /--color-logo-cube:\s*var\(--logo-cube\);/)
  assert.match(tokensCss, /--color-logo-cradle:\s*var\(--logo-cradle\);/)
})

test("root README headers reference the adaptive light/dark wordmark picture", () => {
  for (const file of ["README.md", "README.vi.md"]) {
    const md = readFileSync(resolve(REPO_ROOT, file), "utf8")
    assert.match(md, /srcset="\.github\/assets\/logo-wordmark-dark\.svg"/)
    assert.match(md, /srcset="\.github\/assets\/logo-wordmark\.svg"/)
    assert.match(md, /src="\.github\/assets\/logo-wordmark\.svg"/)
  }
})
