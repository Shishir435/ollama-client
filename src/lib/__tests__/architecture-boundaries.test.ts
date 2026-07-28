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
})
