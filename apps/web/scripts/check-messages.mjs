// So sánh key bản dịch của từng ngôn ngữ với ngôn ngữ mặc định (vi).
// Chạy: pnpm i18n:check
// - Key THIẾU: chỉ cảnh báo (app tự hiện bằng ngôn ngữ mặc định) — giúp dịch dần.
// - Key THỪA (không có trong vi): báo lỗi — thường là gõ sai tên key.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const MESSAGES_DIR = join(import.meta.dirname, "..", "messages")
const DEFAULT_LOCALE = "vi"

function isMessageObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function flatten(tree, file, prefix = "") {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "string") return [path]
    if (isMessageObject(value)) return flatten(value, file, path)
    throw new Error(`${file} has an invalid message at "${path}". Expected a string or a message object.`)
  })
}

function readKeys(file) {
  const messages = JSON.parse(readFileSync(join(MESSAGES_DIR, file), "utf8"))
  if (!isMessageObject(messages)) throw new Error(`${file} must contain a message object.`)
  return new Set(flatten(messages, file))
}

const baseKeys = readKeys(`${DEFAULT_LOCALE}.json`)
let hasError = false

for (const file of readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"))) {
  const locale = file.replace(/\.json$/, "")
  if (locale === DEFAULT_LOCALE) continue

  const keys = readKeys(file)
  const missing = [...baseKeys].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !baseKeys.has(k))

  console.log(`\n${file}: ${keys.size - extra.length}/${baseKeys.size} key đã dịch`)
  for (const k of missing) console.log(`  ⚠ thiếu: ${k}`)
  for (const k of extra) console.log(`  ✗ thừa (không có trong ${DEFAULT_LOCALE}.json): ${k}`)
  if (extra.length > 0) hasError = true
}

if (hasError) {
  console.error("\nCó key thừa — kiểm tra lại tên key.")
  process.exit(1)
}
console.log("\nOK.")
