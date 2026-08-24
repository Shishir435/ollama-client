/**
 * Bundles the CLI into one minified ES module.
 *
 * Purpose: a user who clones this repository should be able to run the proxy without
 * installing anything from a registry, so the runtime dependency is inlined and the
 * output is a single file `bin/olc` executes. The bridge plugin is not bundled — see
 * `copy-plugin.mjs`.
 *
 * Note: the bundle is written by hand rather than by esbuild, for two reasons. The
 * entry point carries its own shebang, which would end up in the middle of the file
 * once a header is prepended, and one transitive dependency of the OpenCode SDK is
 * CommonJS — ESM output leaves it calling `require`, which Node only provides here
 * through `createRequire`.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outfile = path.join(packageRoot, "dist", "olc.mjs")

const HEADER = [
  "#!/usr/bin/env node",
  'import { createRequire as __olcCreateRequire } from "node:module"',
  "const require = __olcCreateRequire(import.meta.url)",
  ""
].join("\n")

const result = await build({
  entryPoints: [path.join(packageRoot, "src", "cli.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  sourcemap: false,
  legalComments: "none"
})

const [output] = result.outputFiles
if (!output) throw new Error("esbuild produced no output")

const body = output.text.replace(/^(?:#![^\n]*\n)+/, "")
mkdirSync(path.dirname(outfile), { recursive: true })
writeFileSync(outfile, `${HEADER}${body}`, "utf8")
chmodSync(outfile, 0o755)

const kilobytes = (Buffer.byteLength(HEADER + body) / 1024).toFixed(0)
console.log(`[build] bundled CLI to ${outfile} (${kilobytes} KB, minified)`)
