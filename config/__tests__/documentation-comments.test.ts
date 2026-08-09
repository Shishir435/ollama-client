import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const sourceRoots = ["src", "packages", "config", "tools"].map((path) =>
  resolve(root, path)
)
const ignoredDirectories = new Set([
  "__tests__",
  "build",
  "dist",
  "node_modules"
])
const sourceFilePattern = /\.(?:[cm]?[jt]sx?)$/
const testFilePattern = /\.(?:test|spec)\./
const declarationPattern =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:import\b|interface\b|type\b|class\b|function\b|const\b|let\b|var\b|enum\b|namespace\b|module\b)/
const documentationPrefix =
  /^(?:note|usage|why|purpose|contract|invariant|lifecycle|end-to-end|production|dev-only|migration-time)\b/i
const collectSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return []

    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    if (
      !sourceFilePattern.test(entry.name) ||
      testFilePattern.test(entry.name)
    ) {
      return []
    }
    return [path]
  })

const misplacedDocumentation = (file: string): string[] => {
  const lines = readFileSync(file, "utf8").split("\n")
  const findings: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\/\/(?!\/)/.test(lines[index])) continue

    const first = index
    while (index + 1 < lines.length && /^\/\/(?!\/)/.test(lines[index + 1])) {
      index += 1
    }

    const block = lines.slice(first, index + 1)
    if (
      block.some((line) =>
        /biome-ignore|@ts-|eslint|istanbul|c8 ignore/.test(line)
      )
    ) {
      continue
    }

    const content = block.map((line) =>
      line.replace(/^\s*\/\/ ?/, "").trimEnd()
    )
    const prose = content
      .filter((line) => !/^[-=─—]{12,}$/.test(line.trim()))
      .filter(Boolean)
      .join(" ")
    if (!prose) continue

    let next = index + 1
    while (next < lines.length && lines[next].trim() === "") next += 1
    if (
      !declarationPattern.test(lines[next]?.trim() ?? "") &&
      prose.length < 80 &&
      !documentationPrefix.test(prose)
    ) {
      continue
    }

    findings.push(`${relative(root, file)}:${first + 1}`)
  }

  return findings
}

describe("documentation comments", () => {
  it("uses JSDoc for module and declaration documentation", () => {
    const findings = sourceRoots
      .flatMap(collectSourceFiles)
      .flatMap(misplacedDocumentation)
      .sort()

    expect(findings).toEqual([])
  })
})
