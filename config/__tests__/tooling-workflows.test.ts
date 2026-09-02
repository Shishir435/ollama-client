import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
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
