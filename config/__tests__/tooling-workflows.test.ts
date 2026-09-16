import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const workflow = (name: string) =>
  readFileSync(resolve(root, ".github/workflows", name), "utf8")
const { scripts } = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8")
) as { scripts: Record<string, string> }

const buildTargets = [
  "build",
  "build:firefox",
  "benchmark:build",
  "benchmark:build:firefox"
]
const gateCommands = [
  ...buildTargets,
  "check:browser-smoke",
  "e2e:chromium:critical",
  "verify:sw-turn-recovery",
  "verify:sw-agent-recovery",
  "verify:opfs-migration",
  "verify:firefox-opfs-migration"
]

/** Expand orchestration aliases while leaving actual build/gate commands as leaves. */
const executionOrder = (command: string, parents: string[] = []): string[] => {
  if (gateCommands.includes(command)) return [command]
  if (parents.includes(command)) throw new Error(`Recursive script: ${command}`)
  return scripts[command].split(" && ").flatMap((step) => {
    const match = /^pnpm ([\w:-]+)$/.exec(step)
    return match && scripts[match[1]]
      ? executionOrder(match[1], [...parents, command])
      : [step]
  })
}

describe("tooling workflow execution", () => {
  it.each([
    "verify:browser-smoke",
    "verify:local-browsers"
  ])("%s builds each production target only once before checking it", (command) => {
    const order = executionOrder(command)
    expect(order.filter((step) => buildTargets.includes(step))).toEqual([
      "build",
      "build:firefox"
    ])
    expect(order.indexOf("check:browser-smoke")).toBeGreaterThan(
      order.indexOf("build:firefox")
    )
  })

  it.each([
    "verify:release",
    "e2e:release"
  ])("%s builds each release target once and retains all recovery gates", (command) => {
    const order = executionOrder(command)
    expect(order.filter((step) => buildTargets.includes(step))).toEqual(
      buildTargets
    )
    for (const gate of gateCommands.slice(5)) {
      expect(order.filter((step) => step === gate)).toHaveLength(1)
      expect(order.indexOf(gate)).toBeGreaterThan(
        order.indexOf("benchmark:build:firefox")
      )
    }
  })

  it("can run release browser gates on CI artifacts without rebuilding", () => {
    const order = executionOrder("e2e:release:run")
    expect(order.filter((step) => buildTargets.includes(step))).toEqual([])
    expect(order).toEqual(gateCommands.slice(5))
  })

  it("keeps ordinary verification free of browser and documentation builds", () => {
    const order = executionOrder("verify")
    expect(order.some((step) => buildTargets.includes(step))).toBe(false)
    expect(order.some((step) => step.includes("docs build"))).toBe(false)
    expect(order).toContain("vitest run")
  })
})

describe("release gate resolution", () => {
  const ci = workflow("ci.yml")
  const release = workflow("release.yml")

  /**
   * Contract: release.yml resolves a trusted CI run by looking for one job by
   * its exact name. The browser work is sharded and the benchmark runs beside
   * it, so that name belongs to an aggregate job rather than to the job that
   * does the work — and renaming or dropping it would not fail anything until
   * a release quietly stopped being gated.
   */
  it("names a CI job that release.yml can resolve", () => {
    const gate = /select\(\.name == "([^"]+)"\)/.exec(release)?.[1]
    expect(gate).toBeDefined()
    expect(ci).toContain(`    name: ${gate}\n`)
  })

  it("aggregates every browser job behind that name", () => {
    expect(ci).toContain(
      "    name: Critical browser gates\n    needs: [e2e, agent-benchmark]\n"
    )
  })
})
