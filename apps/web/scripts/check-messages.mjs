// So sánh key bản dịch của từng ngôn ngữ với ngôn ngữ mặc định.
// Chạy: pnpm i18n:check
// - Key THIẾU: chỉ cảnh báo (app tự hiện bằng ngôn ngữ mặc định) — giúp dịch dần.
// - Key THỪA hoặc sai cấu trúc so với bản mặc định: báo lỗi.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { defaultLocale, locales } from "../i18n/config.ts"

const MESSAGES_DIR = join(import.meta.dirname, "..", "messages")
const defaultFile = `${defaultLocale}.json`

function isMessageObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function catalogEntries(tree, file, prefix = "") {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (key.includes(".")) throw new Error(`${file} has an invalid key at "${path}". Message keys cannot contain dots.`)
    if (typeof value === "string") return [[path, "message"]]
    if (isMessageObject(value)) return [[path, "namespace"], ...catalogEntries(value, file, path)]
    throw new Error(`${file} has an invalid message at "${path}". Expected a string or a message object.`)
  })
}

function readCatalog(file) {
  const messages = JSON.parse(readFileSync(join(MESSAGES_DIR, file), "utf8"))
  if (!isMessageObject(messages)) throw new Error(`${file} must contain a message object.`)
  return new Map(catalogEntries(messages, file))
}

function messageKeys(catalog) {
  return new Set([...catalog].filter(([, kind]) => kind === "message").map(([path]) => path))
}

const files = readdirSync(MESSAGES_DIR).filter((file) => file.endsWith(".json"))
const missingCatalogs = locales.map((locale) => `${locale}.json`).filter((file) => !files.includes(file))
if (missingCatalogs.length > 0) {
  for (const file of missingCatalogs) console.error(`Missing translation catalog: messages/${file}`)
  process.exit(1)
}

const base = readCatalog(defaultFile)
const baseKeys = messageKeys(base)
let hasError = false

for (const file of files) {
  if (file === defaultFile) continue

  const catalog = readCatalog(file)
  const keys = messageKeys(catalog)
  const conflicts = [...catalog].filter(([path, kind]) => base.has(path) && base.get(path) !== kind)
  const missing = [...baseKeys].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !baseKeys.has(k))

  console.log(`\n${file}: ${keys.size - extra.length}/${baseKeys.size} key đã dịch`)
  for (const k of missing) console.log(`  ⚠ thiếu: ${k}`)
  for (const k of extra) console.log(`  ✗ thừa (không có trong ${defaultFile}): ${k}`)
  for (const [path, kind] of conflicts) {
    console.error(`${file} has a ${kind} at "${path}", but ${defaultFile} expects a ${base.get(path)}.`)
  }
  if (extra.length > 0 || conflicts.length > 0) hasError = true
}

if (hasError) {
  console.error("\nBản dịch có lỗi. Kiểm tra tên và cấu trúc key.")
  process.exit(1)
}
console.log("\nOK.")
