import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const readJson = (path: string) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"))
const lintFixture = (source: string, test = false) => {
  const directory = mkdtempSync(join(root, ".lint-fixture-"))
  const target = test ? join(directory, "__tests__") : directory
  mkdirSync(target, { recursive: true })
  const file = join(target, "fixture.tsx")
  writeFileSync(file, source)
  try {
    return spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/oxlint/bin/oxlint"),
        "--config",
        resolve(root, ".oxlintrc.json"),
        "--deny-warnings",
        "--format",
        "json",
        file
      ],
      { cwd: root, encoding: "utf8" }
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const formatFixture = (source: string, extension = "tsx") =>
  spawnSync(
    process.execPath,
    [
      resolve(root, "node_modules/oxfmt/bin/oxfmt"),
      "--config",
      resolve(root, ".oxfmtrc.json"),
      "--stdin-filepath",
      join(root, `fixture.${extension}`)
    ],
    { cwd: root, encoding: "utf8", input: source }
  )

describe("Oxc toolchain", () => {
  it("pins tools and keeps CI scripts strict without type-aware linting", () => {
    const pkg = readJson("package.json")
    for (const name of ["oxlint", "oxfmt", "@shadcn/lint"]) {
      expect(pkg.devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/)
    }
    for (const name of ["lint", "lint:check", "lint:fix"]) {
      expect(pkg.scripts[name]).toContain("--deny-warnings")
      expect(pkg.scripts[name]).not.toContain("--type-aware")
    }
    expect(readJson(".oxlintrc.json").jsPlugins).toContain("@shadcn/lint")
  })

  it("catches relied-on TypeScript, React, accessibility and regex defects", () => {
    const result = lintFixture(`
      import { useEffect } from "react"
      export function Bad({ value }: { value: any }) {
        useEffect(() => { console.log(value) }, [])
        const pattern = /[\\x00-\\x1f]/
        return <div onClick={() => pattern.test(value)}>
          <label>Missing control</label>
          <a href="/empty" />
          <div dangerouslySetInnerHTML={{ __html: value }} />
          {[value].map((item, index) => <span key={index}>{item}</span>)}
        </div>
      }
    `)
    expect(result.status).toBe(1)
    for (const rule of [
      "no-explicit-any",
      "exhaustive-deps",
      "no-array-index-key",
      "no-danger",
      "label-has-associated-control",
      "anchor-has-content",
      "click-events-have-key-events",
      "no-static-element-interactions",
      "no-control-regex"
    ]) {
      expect(result.stdout).toContain(rule)
    }
  })

  it("rejects raw palette colors through the shadcn plugin", () => {
    const result = lintFixture(
      `export const Bad = () => <div className="bg-red-500" />`
    )
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stdout).toContain("shadcn(no-raw-colors)")
  })

  it("allows explicit any only in test directories", () => {
    const source = "export type Fixture = any"
    expect(lintFixture(source).status).toBe(1)
    expect(lintFixture(source, true).status).toBe(0)
  })

  it("formats all previously formatted file types", () => {
    for (const extension of ["ts", "tsx", "js", "mjs", "json", "css"]) {
      const source =
        extension === "json"
          ? '{"value":1}'
          : extension === "css"
            ? ".fixture{display:block}"
            : 'export const value = "test";'
      const result = formatFixture(source, extension)
      expect(result.status, result.stderr).toBe(0)
      expect(formatFixture(result.stdout, extension).stdout).toBe(result.stdout)
    }
  })

  it("sorts imports stably while preserving side-effect order and style", () => {
    const result = formatFixture(`
      import "./z-side-effect"
      import "./a-side-effect"
      import { z } from "z"
      import { a } from "a"
      export const values = [z, a];
    `)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.indexOf('from "a"')).toBeLessThan(
      result.stdout.indexOf('from "z"')
    )
    expect(result.stdout.indexOf('"./z-side-effect"')).toBeLessThan(
      result.stdout.indexOf('"./a-side-effect"')
    )
    expect(result.stdout).toContain("export const values = [z, a]\n")
    expect(formatFixture(result.stdout).stdout).toBe(result.stdout)
  })

  it("honors rule-specific suppression reasons", () => {
    const result = lintFixture(`
      // oxlint-disable-next-line typescript/no-explicit-any -- External fixture boundary.
      export type External = any
    `)
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})
