// Kiểm tra tương phản màu (WCAG 2.1 AA) cho mọi preset trong styles/themes/.
// Chạy: pnpm theme:check — bắt buộc chạy lại khi thêm/sửa preset.
// Chữ thường ≥ 4.5:1, thành phần giao diện (viền ô nhập, vòng focus) ≥ 3:1.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const THEMES_DIR = join(import.meta.dirname, "..", "styles", "themes")

// [chữ/thành phần, nền, ngưỡng tối thiểu]
const PAIRS = [
  ["foreground", "background", 4.5],
  ["body", "background", 4.5],
  ["ink-soft", "background", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["card-foreground", "card", 4.5],
  ["body", "card", 4.5],
  ["muted-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["primary-foreground", "primary-pressed", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["secondary-foreground", "secondary-pressed", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["destructive", "background", 4.5],
  ["success-foreground", "success", 4.5],
  ["success", "success-soft", 4.5],
  ["success", "background", 4.5],
  ["input", "background", 3],
  ["ring", "background", 3],
  ["primary", "background", 3],
  ["primary", "popover", 3],
]

function parseBlocks(css) {
  const blocks = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (const [, selector, body] of css.matchAll(re)) {
    const vars = {}
    for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name] = value.trim()
    }
    blocks.push({ selector: selector.replace(/\/\*[\s\S]*?\*\//g, "").trim(), vars })
  }
  return blocks
}

function luminance(hex) {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const isHex = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v ?? "")

let failures = 0
for (const file of readdirSync(THEMES_DIR).filter((f) => f.endsWith(".css"))) {
  const blocks = parseBlocks(readFileSync(join(THEMES_DIR, file), "utf8"))
  const light = blocks.find((b) => !b.selector.includes(".dark"))?.vars ?? {}
  const dark = blocks.find((b) => b.selector.includes(".dark"))?.vars ?? {}

  for (const [mode, vars] of [
    ["light", light],
    ["dark", { ...light, ...dark }],
  ]) {
    console.log(`\n${file} — ${mode}`)
    for (const [fg, bg, min] of PAIRS) {
      const [a, b] = [vars[fg], vars[bg]]
      if (!isHex(a) || !isHex(b)) {
        console.log(`  ?  ${fg} / ${bg}: bỏ qua (không phải mã hex)`)
        continue
      }
      const ratio = contrast(a, b)
      const ok = ratio >= min
      if (!ok) failures++
      console.log(
        `  ${ok ? "✓" : "✗"}  ${fg} (${a}) / ${bg} (${b}): ${ratio.toFixed(2)} (≥ ${min})`
      )
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} cặp màu chưa đạt WCAG AA.`)
  process.exit(1)
}
console.log("\nTất cả cặp màu đạt WCAG AA.")
