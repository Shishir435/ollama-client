import { readdirSync } from "node:fs"
import { basename, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const ignoredDirectories = new Set([
  ".git",
  ".wxt",
  "artifacts",
  "build",
  "dist",
  "node_modules"
])
const testFilePattern = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/

const collectTestFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return []

    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectTestFiles(path)
    return testFilePattern.test(entry.name) ? [path] : []
  })

describe("test layout", () => {
  it("keeps test files in __tests__ directories", () => {
    const misplaced = collectTestFiles(root)
      .filter((path) => basename(resolve(path, "..")) !== "__tests__")
      .map((path) => relative(root, path))
      .sort()

    expect(misplaced).toEqual([])
  })
})
