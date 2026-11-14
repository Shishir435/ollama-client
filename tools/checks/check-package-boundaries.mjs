import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Enforces the AGENTS.md rule that environment-independent packages never
 * import React, WXT, browser APIs or app-layer code. `olc` is a separate Node
 * CLI and is exempt.
 */
const PACKAGES = ["contracts", "runtime-core", "chat-runtime", "agent-runtime"]
const FORBIDDEN = [
  /^react($|\/)/,
  /^react-dom($|\/)/,
  /^wxt($|\/)/,
  /^webextension-polyfill$/,
  /^@\//,
  /^~\//,
  /(^|\/)src\/(features|lib|background|application|entrypoints)\//
]
const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g
const SOURCE_RE = /\.(?:ts|tsx|mts|js|mjs)$/

const walk = async (dir) => {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(path)))
    else if (SOURCE_RE.test(entry.name)) out.push(path)
  }
  return out
}

const violations = []
for (const pkg of PACKAGES) {
  const root = new URL(`../../packages/${pkg}/src`, import.meta.url).pathname
  for (const file of await walk(root)) {
    if (file.includes("__tests__")) continue
    const text = await readFile(file, "utf8")
    for (const match of text.matchAll(IMPORT_RE)) {
      if (FORBIDDEN.some((re) => re.test(match[1]))) {
        violations.push(`${file}: forbidden import "${match[1]}"`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Package boundary violations:\n${violations.join("\n")}`)
  process.exit(1)
}
console.log("Package boundaries ok")
