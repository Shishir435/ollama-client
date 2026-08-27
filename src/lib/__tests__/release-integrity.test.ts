import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const PACKAGE_FILES = [
  "package.json",
  "packages/contracts/package.json",
  "packages/runtime-core/package.json",
  "packages/chat-runtime/package.json",
  "packages/olc/package.json"
] as const

const readText = (file: string) =>
  fs.readFileSync(path.join(ROOT, file), { encoding: "utf8" })

describe("release metadata integrity", () => {
  it("keeps every workspace package on the root release version", () => {
    const versions = PACKAGE_FILES.map((file) => {
      const pkg = JSON.parse(readText(file)) as { version?: string }
      return [file, pkg.version] as const
    })
    const rootVersion = versions[0][1]

    expect(rootVersion).toMatch(/^\d+\.\d+\.\d+$/)
    for (const [file, version] of versions) {
      expect(version, `${file} must match the root release version`).toBe(
        rootVersion
      )
    }
  })

  it("keeps the changelog textual and structurally usable", () => {
    const changelog = readText("CHANGELOG.md")

    expect(changelog).not.toContain("\u0000")
    expect(changelog).toContain("# Changelog")
    expect(changelog).toContain("## [Unreleased]")
    expect(changelog).toMatch(/## \[\d+\.\d+\.\d+\]/)
    expect(changelog.indexOf("## [Unreleased]")).toBeLessThan(
      changelog.search(/## \[\d+\.\d+\.\d+\]/)
    )
  })
})
