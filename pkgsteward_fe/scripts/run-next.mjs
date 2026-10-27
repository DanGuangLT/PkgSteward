import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"
import { resolveServerAddress } from "../lib/config/server-address.ts"

const frontendDirectory = fileURLToPath(new URL("../", import.meta.url))

function readEnvironment(filename) {
  try {
    return parseEnv(readFileSync(new URL(`../${filename}`, import.meta.url), "utf8"))
  } catch (error) {
    if (error.code === "ENOENT") return {}
    throw error
  }
}

function runNext() {
  const mode = process.argv[2]
  if (mode !== "dev" && mode !== "start") {
    throw new Error(`Mode must be dev or start (got ${JSON.stringify(mode)})`)
  }

  const local = readEnvironment(".env.local")
  const base = readEnvironment(".env")
  const address = resolveServerAddress([process.env, local, base])
  if (!address.ok) throw new Error(address.message)

  const require = createRequire(import.meta.url)
  const child = spawn(process.execPath, [
    require.resolve("next/dist/bin/next"), mode, "-p", String(address.port), "-H", address.host,
  ], { cwd: frontendDirectory, stdio: "inherit", shell: false })
  child.once("error", (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.once("exit", (code) => {
    process.exitCode = code ?? 1
  })
}

try {
  runNext()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
