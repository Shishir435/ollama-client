import { readdir, readFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

/**
 * Enforces the AGENTS.md rule that environment-independent packages never
 * import React, WXT, browser APIs or app code. `olc` is a separate Node CLI
 * and is exempt.
 */
const PACKAGES = ["contracts", "runtime-core", "chat-runtime", "agent-runtime"]
const FORBIDDEN_MODULES = [
  /^react($|\/)/,
  /^react-dom($|\/)/,
  /^wxt($|\/)/,
  /^webextension-polyfill$/,
  /^@plasmohq\/storage($|\/)/,
  /^@\//,
  /^~\//
]
const SOURCE_RE = /\.(?:ts|tsx|mts|js|mjs)$/

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))

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

/**
 * Lists module specifiers through the TypeScript scanner, so comments and
 * string contents never count as imports and dynamic imports/require do.
 */
const importsOf = (text) =>
  ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName)

const violations = []
for (const pkg of PACKAGES) {
  const pkgRoot = join(REPO_ROOT, "packages", pkg)
  for (const file of await walk(join(pkgRoot, "src"))) {
    if (file.includes(`${sep}__tests__${sep}`)) continue
    for (const specifier of importsOf(await readFile(file, "utf8"))) {
      const escapesPackage =
        specifier.startsWith(".") &&
        relative(pkgRoot, resolve(dirname(file), specifier)).startsWith("..")
      if (
        escapesPackage ||
        FORBIDDEN_MODULES.some((re) => re.test(specifier))
      ) {
        violations.push(
          `${relative(REPO_ROOT, file)}: forbidden import "${specifier}"`
        )
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Package boundary violations:\n${violations.join("\n")}`)
  process.exit(1)
}
console.log("Package boundaries ok")
