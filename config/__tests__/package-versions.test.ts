import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")

const readVersion = (packageJsonPath: string): string => {
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: string
  }
  return parsed.version ?? ""
}

/**
 * Every workspace package ships with the extension, including the standalone `olc`
 * CLI, so their versions track the extension's. A CLI at its own version number makes
 * "which build is this" unanswerable from a release tag.
 */
describe("workspace package versions", () => {
  it("match the extension version", () => {
    const expected = readVersion(resolve(root, "package.json"))
    expect(expected).toMatch(/^\d+\.\d+\.\d+/)

    const packages = readdirSync(resolve(root, "packages"), {
      withFileTypes: true
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    const versions = Object.fromEntries(
      packages.map((name) => [
        name,
        readVersion(resolve(root, "packages", name, "package.json"))
      ])
    )

    expect(versions).toEqual(
      Object.fromEntries(packages.map((name) => [name, expected]))
    )
  })

  /**
   * A release archive ships `dist/` and `bin/` with no `package.json`, so the
   * installed CLI reports and compares its version from a compiled-in literal.
   * `olc update` decides whether it is current by comparing that literal to a
   * release tag, and a stale one would report every build as up to date.
   */
  it("match the version compiled into the olc CLI", () => {
    const expected = readVersion(resolve(root, "package.json"))
    const source = readFileSync(
      resolve(root, "packages/olc/src/version.ts"),
      "utf8"
    )
    expect(source).toContain(`export const OLC_VERSION = "${expected}"`)
  })
})
