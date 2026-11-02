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
  "verify:extraction-inert",
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
  it.each(["verify:browser-smoke", "verify:local-browsers"])(
    "%s builds each production target only once before checking it",
    (command) => {
      const order = executionOrder(command)
      expect(order.filter((step) => buildTargets.includes(step))).toEqual([
        "build",
        "build:firefox"
      ])
      expect(order.indexOf("check:browser-smoke")).toBeGreaterThan(
        order.indexOf("build:firefox")
      )
    }
  )

  it.each(["verify:release", "e2e:release"])(
    "%s builds each release target once and retains all recovery gates",
    (command) => {
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
    }
  )

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

  /**
   * A pull request may skip the benchmark, and only a pull request: on a push
   * or a dispatch, which is where release.yml reads this job from, a skipped
   * benchmark has to fail the gate rather than pass it.
   */
  it("lets only a pull request pass the gate without the benchmark", () => {
    const gate = ci.slice(ci.indexOf("    name: Critical browser gates\n"))
    const condition = /    if: >-\n([\s\S]*?)\n    runs-on:/.exec(gate)?.[1]
    expect(condition).toContain("needs.e2e.result == 'success'")
    expect(condition).toContain("needs.agent-benchmark.result == 'success'")
    expect(condition).toMatch(
      /github\.event_name == 'pull_request'[\s\S]*needs\.agent-benchmark\.result == 'skipped'/
    )
  })
})

describe("browser gate sharding", () => {
  const ci = workflow("ci.yml")

  /**
   * The shard count is written in four places the workflow cannot derive from
   * one another: the planner argument, the job name, the matrix and the grep
   * file each shard reads. A planned shard no runner picks up is a group of
   * tests that silently never run.
   */
  it("writes one shard count everywhere it appears", () => {
    const planned = /create-critical-browser-shards\.mjs (\d+)/.exec(ci)?.[1]
    const named =
      /Critical browser gates \(shard \$\{\{ matrix\.shard \}\}\/(\d+)\)/.exec(
        ci
      )?.[1]
    const matrix =
      /name: Critical browser gates \(shard[\s\S]*?shard: \[([\d, ]+)\]/.exec(
        ci
      )?.[1]
    const files = [
      ...ci.matchAll(/critical-shard-\$\{\{ matrix\.shard \}\}-of-(\d+)\.grep/g)
    ]
    expect(planned).toBeDefined()
    expect(named).toBe(planned)
    expect(matrix?.split(",").length).toBe(Number(planned))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(file[1]).toBe(planned)
  })

  it("keeps the migration gates behind the changed-area check on pull requests", () => {
    for (const job of [
      "persistence-migration",
      "persistence-migration-firefox"
    ]) {
      const block = ci
        .slice(ci.indexOf(`  ${job}:\n`))
        .split(/\n  [a-z-]+:\n/)[0]
      expect(block).toContain("needs.changes.outputs.persistence == 'true'")
    }
  })
})
