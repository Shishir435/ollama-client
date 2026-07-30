import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

const sourceRoot = join(process.cwd(), "src")

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const productionSources = walk(sourceRoot)
  .filter((path) => /\.(ts|tsx)$/.test(path))
  .filter((path) => !path.endsWith(".d.ts"))
  .map((path) => relative(sourceRoot, path).replaceAll("\\", "/"))
  .filter((path) => !path.includes("__tests__/"))
  .filter((path) => !path.startsWith("test/"))

const importsModule = (source: string, modulePath: RegExp): boolean =>
  new RegExp(
    String.raw`(?:from\s+|import\s*\()\s*["']${modulePath.source}["']`
  ).test(source)

describe("architecture import boundaries", () => {
  it("routes chat-history callers through the public repository facade", () => {
    const allowed = new Set([
      "entrypoints/persistence-verify/main.ts",
      "lib/repositories/chat-history.ts"
    ])
    const offenders = productionSources.filter((file) => {
      if (allowed.has(file)) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(
        source,
        /(?:@\/lib\/repositories\/|\.\/)sqlite-chat-history/
      )
    })

    expect(offenders).toEqual([])
  })

  it("keeps SQLite internals out of UI and feature modules", () => {
    const uiRoots = [
      "components/",
      "features/",
      "hooks/",
      "options/",
      "sidepanel/",
      "stores/"
    ]
    const offenders = productionSources.filter((file) => {
      if (!uiRoots.some((root) => file.startsWith(root))) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(source, /@\/lib\/sqlite\/(?:db|schema)/)
    })

    expect(offenders).toEqual([])
  })

  it("keeps root stores limited to cross-feature concerns", () => {
    const allowedRootStores = new Set([
      "stores/search-dialog-store.ts",
      "stores/shortcut-store.ts",
      "stores/theme.ts"
    ])
    const rootStores = productionSources.filter(
      (file) => file.startsWith("stores/") && !allowedRootStores.has(file)
    )

    expect(rootStores).toEqual([])
  })

  /**
   * sql.js exists for one job: serving history to a profile still on the legacy
   * blob backend. Everything else — surveying a source database, verifying an
   * import, restoring a backup — runs on official sqlite-wasm, which reads the
   * same file format.
   *
   * A new runtime import here is how the second engine comes back, and it comes
   * back permanently: once two engines read the same file, verification is
   * comparing engines instead of checking a migration.
   *
   * The three dev-only entrypoints are exempt because `config/wxt-hooks.ts`
   * strips them from store builds. The migration-verification harness is the one
   * place sql.js is still the right tool: its fixtures have to *write* blobs in
   * the old topology, which is all sql.js was ever needed for. Type-only imports
   * in the migration runner do not pull the runtime in.
   */
  it("keeps the sql.js runtime to the legacy fallback alone", () => {
    const allowed = new Set([
      "lib/sqlite/legacy-db.ts",
      "entrypoints/benchmark/main.ts",
      "entrypoints/spike-opfs/main.ts",
      "entrypoints/persistence-verify/main.ts"
    ])
    const offenders = productionSources.filter((file) => {
      if (allowed.has(file)) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(source, /sql\.js\/dist\/sql-wasm\.js/)
    })

    expect(offenders).toEqual([])
  })

  it("keeps application and infrastructure layers independent of features", () => {
    const lowerLayerRoots = ["application/", "background/", "lib/"]
    const offenders = productionSources.filter((file) => {
      if (!lowerLayerRoots.some((root) => file.startsWith(root))) return false
      const source = readFileSync(join(sourceRoot, file), "utf8")
      return importsModule(source, /@\/features\/[^"']+/)
    })

    expect(offenders).toEqual([])
  })
})
