import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const lockfile = readFileSync("pnpm-lock.yaml", "utf8")
const atLeast = (version: string, floor: string) => {
  const actual = version.split(".").map(Number)
  const minimum = floor.split(".").map(Number)
  for (let index = 0; index < 3; index++) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index]
  }
  return true
}

describe("production dependency security floors", () => {
  it.each([
    ["dompurify", "3.4.16"],
    ["markdown-it", "14.3.1"],
    ["postcss", "8.5.23"],
    ["mermaid", "11.16.1"],
    ["postcss-selector-parser", "7.1.6"],
    ["brace-expansion", "5.0.12"],
    ["smol-toml", "1.9.0"],
    ["katex", "0.18.2"]
  ])("keeps %s at or above its patched floor", (name, floor) => {
    const versions = Array.from(
      lockfile.matchAll(
        new RegExp(`^  ${name}@([0-9]+\\.[0-9]+\\.[0-9]+)[:(]`, "gm")
      ),
      (match) => match[1]
    )
    expect(versions.length).toBeGreaterThan(0)
    for (const version of versions) {
      // The advisories do not affect brace-expansion v1/v2.
      if (name === "brace-expansion" && Number(version.split(".")[0]) < 3)
        continue
      expect(atLeast(version, floor), `${name}@${version} < ${floor}`).toBe(
        true
      )
    }
  })

  it("drops Mammoth's vulnerable sprintf-js parser dependency", () => {
    expect(/^  sprintf-js@/m.test(lockfile)).toBe(false)
  })
})
