/**
 * Copies the OpenCode bridge plugin into the build output.
 *
 * Why they are not compiled or bundled: OpenCode's runtime loads these files from a
 * generated directory and executes TypeScript directly, so the proxy copies the
 * sources verbatim at run time. Compiling them here would emit a second, unused entry
 * point; bundling them would make them unreadable to the runtime that runs them.
 */
import { cpSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = path.join(packageRoot, "src", "backends", "opencode", "plugin")
const destination = path.join(
  packageRoot,
  "dist",
  "backends",
  "opencode",
  "plugin"
)

mkdirSync(destination, { recursive: true })
cpSync(source, destination, { recursive: true })
console.log(`[build] copied bridge plugin to ${destination}`)
