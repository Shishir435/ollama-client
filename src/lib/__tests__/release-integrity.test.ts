import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../../..")

const readText = (file: string) =>
  fs.readFileSync(path.join(ROOT, file), { encoding: "utf8" })

describe("release metadata integrity", () => {
  it("keeps the changelog textual and documents the current release", () => {
    const changelog = readText("CHANGELOG.md")
    const rootPackage = JSON.parse(readText("package.json")) as {
      version: string
    }
    const releaseHeading = `## [${rootPackage.version}]`
    const headings = [...changelog.matchAll(/^## \[([^\]]+)\]$/gm)].map(
      (match) => match[0]
    )

    expect(changelog).not.toContain("\u0000")
    expect(changelog).toContain("# Changelog")
    expect(headings[0]).toBe("## [Unreleased]")
    expect(headings[1]).toBe(releaseHeading)
  })
})
