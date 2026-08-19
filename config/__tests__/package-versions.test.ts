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
})
