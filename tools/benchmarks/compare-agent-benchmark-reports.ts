#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import type {
  AgentAttemptRecord,
  AgentBenchmarkReport
} from "../../e2e/chromium/benchmark/agent-benchmark"

interface MatchedAttempt {
  family: string
  scenario: string
  attempt: number
  ollamaClient: AgentAttemptRecord
  nanobrowser: AgentAttemptRecord
}

interface RunMetadata {
  reasoningEffort?: string
}

const readReport = (path: string): AgentBenchmarkReport =>
  JSON.parse(readFileSync(path, "utf8")) as AgentBenchmarkReport

const keyOf = (attempt: AgentAttemptRecord): string =>
  `${attempt.family}\u0000${attempt.scenario}\u0000${attempt.attempt}`

const reasoningEffortFor = (
  report: AgentBenchmarkReport,
  reportPath: string
): string | undefined => {
  if (report.reasoningEffort) return report.reasoningEffort
  const runMetadataPath = resolve(
    dirname(dirname(dirname(reportPath))),
    "run.json"
  )
  if (!existsSync(runMetadataPath)) return undefined
  const metadata = JSON.parse(
    readFileSync(runMetadataPath, "utf8")
  ) as RunMetadata
  return metadata.reasoningEffort
}

const indexAttempts = (
  report: AgentBenchmarkReport,
  label: string
): Map<string, AgentAttemptRecord> => {
  const indexed = new Map<string, AgentAttemptRecord>()
  for (const attempt of report.attempts) {
    const key = keyOf(attempt)
    if (indexed.has(key))
      throw new Error(
        `${label} contains duplicate scenario ${attempt.scenario}.`
      )
    indexed.set(key, attempt)
  }
  return indexed
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? Math.round((ordered[middle - 1] + ordered[middle]) / 2)
    : ordered[middle]
}

const count = (
  attempts: AgentAttemptRecord[],
  predicate: (attempt: AgentAttemptRecord) => boolean
): number => attempts.filter(predicate).length

const familyStats = (attempts: AgentAttemptRecord[]) => ({
  n: attempts.length,
  goalMet: count(attempts, (attempt) => attempt.succeeded === true),
  reportedComplete: count(
    attempts,
    (attempt) => attempt.terminalStatus === "completed"
  ),
  falseCompletions: count(
    attempts,
    (attempt) => attempt.falseCompletion === true
  ),
  medianWallMs: median(attempts.map((attempt) => attempt.wallMs)),
  medianModelCalls: median(attempts.map((attempt) => attempt.modelCalls))
})

const render = (input: {
  baselinePath: string
  candidatePath: string
  baseline: AgentBenchmarkReport
  candidate: AgentBenchmarkReport
  baselineReasoningEffort: string
  candidateReasoningEffort: string
  matched: MatchedAttempt[]
  ollamaOnly: AgentAttemptRecord[]
  nanobrowserOnly: AgentAttemptRecord[]
}): string => {
  const families = [...new Set(input.matched.map((item) => item.family))].sort()
  const lines = [
    "# Agent benchmark comparison",
    "",
    `- Ollama Client report: \`${input.baselinePath}\` (${input.baseline.attempts.length} attempts)`,
    `- Nanobrowser report: \`${input.candidatePath}\` (${input.candidate.attempts.length} attempts)`,
    `- Model: \`${input.candidate.model}\`; matched scenarios: ${input.matched.length}`,
    `- Reasoning effort: Ollama Client \`${input.baselineReasoningEffort}\`; Nanobrowser \`${input.candidateReasoningEffort}\``,
    `- Ollama Client only: ${input.ollamaOnly.length}; Nanobrowser only: ${input.nanobrowserOnly.length}`,
    "",
    "Counts use the same scenario and attempt number in both reports. A blank goal result means that report did not record a page predicate.",
    "",
    "## Matched families",
    "",
    "| family | n | Ollama goal met | Nanobrowser goal met | Ollama false completions | Nanobrowser false completions | Ollama median ms | Nanobrowser median ms | time delta ms | Ollama model calls median | Nanobrowser model calls median |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  ]

  for (const family of families) {
    const pairs = input.matched.filter((item) => item.family === family)
    const ollama = familyStats(pairs.map((pair) => pair.ollamaClient))
    const nano = familyStats(pairs.map((pair) => pair.nanobrowser))
    lines.push(
      `| ${family} | ${pairs.length} | ${ollama.goalMet} | ${nano.goalMet} | ${ollama.falseCompletions} | ${nano.falseCompletions} | ${ollama.medianWallMs ?? "—"} | ${nano.medianWallMs ?? "—"} | ${ollama.medianWallMs === null || nano.medianWallMs === null ? "—" : nano.medianWallMs - ollama.medianWallMs} | ${ollama.medianModelCalls ?? "—"} | ${nano.medianModelCalls ?? "—"} |`
    )
  }

  lines.push(
    "",
    "## Matched scenarios",
    "",
    "| family | scenario | Ollama status | Ollama goal met | Nanobrowser status | Nanobrowser goal met | Ollama ms | Nanobrowser ms |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: |"
  )
  for (const pair of input.matched) {
    lines.push(
      `| ${pair.family} | ${pair.scenario} | ${pair.ollamaClient.terminalStatus} | ${pair.ollamaClient.succeeded === undefined ? "—" : Number(pair.ollamaClient.succeeded)} | ${pair.nanobrowser.terminalStatus} | ${pair.nanobrowser.succeeded === undefined ? "—" : Number(pair.nanobrowser.succeeded)} | ${pair.ollamaClient.wallMs} | ${pair.nanobrowser.wallMs} |`
    )
  }
  lines.push("")
  return `${lines.join("\n")}\n`
}

const main = (): void => {
  const [baselineArgument, candidateArgument, outputArgument] =
    process.argv.slice(2)
  if (!baselineArgument || !candidateArgument || !outputArgument) {
    throw new Error(
      "Usage: tsx compare-agent-benchmark-reports.ts <ollama-client-merged.json> <nanobrowser-merged.json> <output-dir>"
    )
  }
  const baselinePath = resolve(baselineArgument)
  const candidatePath = resolve(candidateArgument)
  const outputDirectory = resolve(outputArgument)
  const baseline = readReport(baselinePath)
  const candidate = readReport(candidatePath)
  if (baseline.model !== candidate.model)
    throw new Error(
      `Reports use different models (${baseline.model} vs ${candidate.model}).`
    )
  const baselineReasoningEffort = reasoningEffortFor(baseline, baselinePath)
  const candidateReasoningEffort = reasoningEffortFor(candidate, candidatePath)
  if (!baselineReasoningEffort || !candidateReasoningEffort)
    throw new Error(
      "Cannot verify that reports use the same reasoning effort. Reports must include reasoningEffort or sit beside a run.json with that setting."
    )
  if (baselineReasoningEffort !== candidateReasoningEffort)
    throw new Error(
      `Reports use different reasoning efforts (${baselineReasoningEffort} vs ${candidateReasoningEffort}).`
    )

  const ollamaIndex = indexAttempts(baseline, "Ollama Client")
  const nanobrowserIndex = indexAttempts(candidate, "Nanobrowser")
  const matched: MatchedAttempt[] = []
  const ollamaOnly: AgentAttemptRecord[] = []
  const nanobrowserOnly: AgentAttemptRecord[] = []
  for (const [key, ollamaClient] of ollamaIndex) {
    const nanobrowser = nanobrowserIndex.get(key)
    if (!nanobrowser) {
      ollamaOnly.push(ollamaClient)
      continue
    }
    matched.push({
      family: ollamaClient.family,
      scenario: ollamaClient.scenario,
      attempt: ollamaClient.attempt,
      ollamaClient,
      nanobrowser
    })
  }
  for (const [key, nanobrowser] of nanobrowserIndex) {
    if (!ollamaIndex.has(key)) nanobrowserOnly.push(nanobrowser)
  }
  matched.sort(
    (left, right) =>
      left.family.localeCompare(right.family) ||
      left.scenario.localeCompare(right.scenario) ||
      left.attempt - right.attempt
  )
  if (matched.length === 0)
    throw new Error(
      "The reports have no matched attempts, so there is nothing to compare."
    )

  const comparison = {
    comparedAt: new Date().toISOString(),
    model: candidate.model,
    reasoningEffort: candidateReasoningEffort,
    baseline: {
      product: "ollama-client",
      backend: baseline.backend,
      reasoningEffort: baselineReasoningEffort,
      reportPath: baselinePath,
      attemptCount: baseline.attempts.length
    },
    candidate: {
      product: "nanobrowser",
      backend: candidate.backend,
      reasoningEffort: candidateReasoningEffort,
      reportPath: candidatePath,
      attemptCount: candidate.attempts.length
    },
    matchedCount: matched.length,
    ollamaOnly: ollamaOnly.map((attempt) => ({
      family: attempt.family,
      scenario: attempt.scenario,
      attempt: attempt.attempt
    })),
    nanobrowserOnly: nanobrowserOnly.map((attempt) => ({
      family: attempt.family,
      scenario: attempt.scenario,
      attempt: attempt.attempt
    })),
    matchedAttempts: matched
  }
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(
    resolve(outputDirectory, "comparison.json"),
    `${JSON.stringify(comparison, null, 2)}\n`
  )
  writeFileSync(
    resolve(outputDirectory, "comparison.md"),
    render({
      baselinePath: basename(baselinePath),
      candidatePath: basename(candidatePath),
      baseline,
      candidate,
      baselineReasoningEffort,
      candidateReasoningEffort,
      matched,
      ollamaOnly,
      nanobrowserOnly
    })
  )
  console.info(
    `Compared ${matched.length} matched scenario(s); ${ollamaOnly.length} Ollama Client only, ${nanobrowserOnly.length} Nanobrowser only.`
  )
}

main()
