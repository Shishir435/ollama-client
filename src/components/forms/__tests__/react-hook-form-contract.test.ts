import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = process.cwd()
const sourceRoot = join(repoRoot, "src")

const ignoredSegments = new Set(["__tests__", "components/ui"])

const listTsxFiles = (dir: string): string[] => {
  const files: string[] = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const relativePath = relative(sourceRoot, path)

    if (
      [...ignoredSegments].some((segment) => relativePath.includes(segment))
    ) {
      continue
    }

    if (statSync(path).isDirectory()) {
      files.push(...listTsxFiles(path))
      continue
    }

    if (path.endsWith(".tsx")) files.push(path)
  }

  return files
}

describe("React Hook Form field binding contract", () => {
  it("does not spread register() into app UI fields", () => {
    const offenders = listTsxFiles(sourceRoot).flatMap((path) => {
      const text = readFileSync(path, "utf-8")
      if (!/{\s*\.\.\.\s*register\s*\(/.test(text)) return []
      return [relative(repoRoot, path)]
    })

    expect(offenders).toEqual([])
  })
})
