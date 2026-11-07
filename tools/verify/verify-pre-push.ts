#!/usr/bin/env tsx

import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { performance } from "node:perf_hooks"

type Check = {
  label: string
  args: string[]
}

type Lane = {
  name: string
  checks: Check[]
}

type CheckResult = {
  label: string
  passed: boolean
  durationMs: number
}

const repoRoot = resolve(import.meta.dirname, "../..")
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const results: CheckResult[] = []

const runCheck = (check: Check): Promise<boolean> =>
  new Promise((complete) => {
    const startedAt = performance.now()
    let settled = false

    console.log(`\n▶ ${check.label}`)
    const child = spawn(pnpmCommand, check.args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    })

    const finish = (passed: boolean, detail = "") => {
      if (settled) return
      settled = true

      const durationMs = performance.now() - startedAt
      results.push({ label: check.label, passed, durationMs })
      const durationSeconds = (durationMs / 1000).toFixed(1)
      console.log(
        `${passed ? "✓" : "✗"} ${check.label} (${durationSeconds}s)${detail}`
      )
      complete(passed)
    }

    child.once("error", (error) => finish(false, `: ${error.message}`))
    child.once("close", (code, signal) =>
      finish(
        code === 0,
        code === 0
          ? ""
          : signal
            ? ` (${signal})`
            : ` (exit ${code ?? "unknown"})`
      )
    )
  })

const runLane = async (lane: Lane): Promise<boolean> => {
  for (const check of lane.checks) {
    if (!(await runCheck(check))) {
      console.error(`✗ ${lane.name} stopped after a failed check`)
      return false
    }
  }
  return true
}

const runStage = async (name: string, lanes: Lane[]): Promise<boolean> => {
  const startedAt = performance.now()
  console.log(`\n=== ${name}: ${lanes.length} parallel lanes ===`)
  const outcomes = await Promise.all(lanes.map(runLane))
  const durationSeconds = ((performance.now() - startedAt) / 1000).toFixed(1)
  const passed = outcomes.every(Boolean)
  console.log(`${passed ? "✓" : "✗"} ${name} (${durationSeconds}s wall time)`)
  return passed
}

const fail = (stage: string) => {
  console.error(`\nPre-push blocked: ${stage} failed.`)
  console.error("Checks that passed:")
  for (const result of results.filter(({ passed }) => passed)) {
    console.error(
      `  ✓ ${result.label} (${(result.durationMs / 1000).toFixed(1)}s)`
    )
  }
  process.exitCode = 1
}

const main = async () => {
  const startedAt = performance.now()

  // Generated resources are written here. Finish this stage before tests or
  // static readers start, while the independent audit runs alongside it.
  if (
    !(await runStage("Audit and generated-resource validation", [
      {
        name: "Dependency audit",
        checks: [
          {
            label: "Production dependency audit",
            args: ["audit", "--prod", "--audit-level", "high"]
          }
        ]
      },
      {
        name: "Generated resources",
        checks: [
          {
            label: "Generated-resource consistency",
            args: ["check:generated"]
          }
        ]
      }
    ]))
  ) {
    fail("Audit or generated-resource validation")
    return
  }

  // Two full-suite shards were faster than a serial local run while keeping
  // worker contention bounded. The 30-second timeout
  // is the same cap used by coverage runs; under local contention the default
  // five-second cap timed out two SQLite batch tests despite their passing
  // alone. Keep static checks serialized in one lane.
  if (
    !(await runStage("Full verification", [
      {
        name: "Unit tests shard 1/2",
        checks: [
          {
            label: "Full unit suite shard 1/2",
            args: ["test:run", "--shard=1/2", "--testTimeout=30000"]
          }
        ]
      },
      {
        name: "Unit tests shard 2/2",
        checks: [
          {
            label: "Full unit suite shard 2/2",
            args: ["test:run", "--shard=2/2", "--testTimeout=30000"]
          }
        ]
      },
      {
        name: "Typecheck",
        checks: [{ label: "Typecheck", args: ["typecheck"] }]
      },
      {
        name: "Read-only static checks",
        checks: [
          { label: "Lint", args: ["lint:check"] },
          { label: "Formatting", args: ["format:check"] },
          { label: "Dead-code check", args: ["check:dead"] },
          { label: "i18n check", args: ["check:i18n"] },
          { label: "Compatibility check", args: ["check:compatibility"] }
        ]
      }
    ]))
  ) {
    fail("Full verification")
    return
  }

  if (
    !(await runLane({
      name: "Chrome package",
      checks: [{ label: "Chrome package", args: ["package"] }]
    }))
  ) {
    fail("Chrome package")
    return
  }

  // Only one WXT build runs at a time. The Chrome bundle check reads the
  // completed Chrome output and can overlap Firefox resource generation/build.
  if (
    !(await runStage("Browser package checks", [
      {
        name: "Chrome bundle",
        checks: [{ label: "Chrome bundle budget", args: ["bundle:check"] }]
      },
      {
        name: "Firefox package",
        checks: [{ label: "Firefox package", args: ["package:firefox"] }]
      }
    ]))
  ) {
    fail("Browser package checks")
    return
  }

  if (
    !(await runLane({
      name: "Firefox bundle",
      checks: [
        { label: "Firefox bundle budget", args: ["bundle:check:firefox"] }
      ]
    }))
  ) {
    fail("Firefox bundle check")
    return
  }

  const durationSeconds = ((performance.now() - startedAt) / 1000).toFixed(1)
  console.log(`\nAll pre-push checks passed in ${durationSeconds}s.`)
}

void main().catch((error: unknown) => {
  console.error(
    "Pre-push verification could not finish:",
    error instanceof Error ? error.message : "unknown error"
  )
  process.exitCode = 1
})
