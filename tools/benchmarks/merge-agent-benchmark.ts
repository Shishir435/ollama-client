#!/usr/bin/env node

/**
 * Every benchmark shard's partial, read back as the pass's one record.
 *
 * The suite used to check its own completeness in the worker that wrote the
 * report — a pass that lost a task to a retry must not produce a report that
 * looks complete. Sharded, no worker sees every attempt, so the check moved
 * here and got stricter on the way: a worker could only ever fail on attempts
 * it knew about, and a shard that never ran at all produced no assertion to
 * fail. This sees the whole set or says so.
 *
 * Usage: pnpm benchmark:merge [inputDir] [outputDir]
 * Reads every agent-benchmark-*.json under inputDir, writes the merged record
 * to outputDir, and exits non-zero when the pass is short or doubled.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs"
import { resolve } from "node:path"

import type { AgentBenchmarkReport } from "../../e2e/chromium/benchmark/agent-benchmark"
import {
  mergeAgentBenchmarkReports,
  renderAgentBenchmarkMarkdown
} from "../../e2e/chromium/benchmark/agent-benchmark"
import { benchmarkExpectedAttempts } from "../../e2e/chromium/benchmark/benchmark-counts"

const inputDir = resolve(process.argv[2] ?? "artifacts/e2e/benchmark-partials")
const outputDir = resolve(process.argv[3] ?? "artifacts/e2e/benchmark")

const collect = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collect(path)
    return entry.name.startsWith("agent-benchmark-") &&
      entry.name.endsWith(".json")
      ? [path]
      : []
  })
}

const main = (): void => {
  if (!statSync(inputDir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`No benchmark partials directory at ${inputDir}`)
    process.exit(1)
  }

  const files = collect(inputDir)
  if (files.length === 0) {
    console.error(`No agent-benchmark-*.json partials under ${inputDir}`)
    process.exit(1)
  }

  const partials = files.map(
    (file) => JSON.parse(readFileSync(file, "utf8")) as AgentBenchmarkReport
  )
  const merged = mergeAgentBenchmarkReports(partials, benchmarkExpectedAttempts)

  mkdirSync(outputDir, { recursive: true })
  const stamp = Date.now()
  writeFileSync(
    resolve(outputDir, `agent-benchmark-${stamp}.json`),
    JSON.stringify(merged.report, null, 2)
  )
  writeFileSync(
    resolve(outputDir, `agent-benchmark-${stamp}.md`),
    renderAgentBenchmarkMarkdown(merged.report)
  )

  console.log(
    `Merged ${partials.length} partial(s): ${merged.found} of ${merged.expected} attempts.`
  )
  if (merged.duplicates.length > 0) {
    console.error(`Recorded twice: ${merged.duplicates.join(", ")}`)
  }
  if (!merged.complete) {
    console.error(
      "The pass is not complete. The record is written for inspection, but it does not stand as a measurement."
    )
    process.exit(1)
  }
}

main()
