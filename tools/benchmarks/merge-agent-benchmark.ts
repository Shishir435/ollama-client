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
import { fileURLToPath } from "node:url"

import type { AgentBenchmarkReport } from "../../e2e/chromium/benchmark/agent-benchmark"
import {
  mergeAgentBenchmarkReports,
  renderAgentBenchmarkMarkdown
} from "../../e2e/chromium/benchmark/agent-benchmark"
import { benchmarkExpectedAttempts } from "../../e2e/chromium/benchmark/benchmark-counts"

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

export interface AgentBenchmarkMergeResult {
  exitCode: number
  messages: string[]
  errors: string[]
}

export const mergeAgentBenchmarkDirectory = (
  inputDirectory: string,
  outputDirectory: string
): AgentBenchmarkMergeResult => {
  const inputDir = resolve(inputDirectory)
  const outputDir = resolve(outputDirectory)
  if (!statSync(inputDir, { throwIfNoEntry: false })?.isDirectory()) {
    return {
      exitCode: 1,
      messages: [],
      errors: [`No benchmark partials directory at ${inputDir}`]
    }
  }

  const files = collect(inputDir)
  if (files.length === 0) {
    return {
      exitCode: 1,
      messages: [],
      errors: [`No agent-benchmark-*.json partials under ${inputDir}`]
    }
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

  const errors: string[] = []
  if (merged.duplicates.length > 0)
    errors.push(`Recorded twice: ${merged.duplicates.join(", ")}`)
  if (merged.reasoningEfforts.length > 1)
    errors.push(
      `Partials use mixed reasoning efforts: ${merged.reasoningEfforts.join(", ")}`
    )
  if (!merged.complete)
    errors.push(
      "The pass is not complete. The record is written for inspection, but it does not stand as a measurement."
    )
  return {
    exitCode: merged.complete ? 0 : 1,
    messages: [
      `Merged ${partials.length} partial(s): ${merged.found} of ${merged.expected} attempts.`
    ],
    errors
  }
}

const main = (): void => {
  const result = mergeAgentBenchmarkDirectory(
    process.argv[2] ?? "artifacts/e2e/benchmark-partials",
    process.argv[3] ?? "artifacts/e2e/benchmark"
  )
  for (const message of result.messages) console.log(message)
  for (const error of result.errors) console.error(error)
  process.exitCode = result.exitCode
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
