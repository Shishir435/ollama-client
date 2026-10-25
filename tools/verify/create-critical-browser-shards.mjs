#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dirname, "../..")
const [shardCountArgument] = process.argv.slice(2)
const shardCount = Number(shardCountArgument)

if (!Number.isInteger(shardCount) || shardCount < 1) {
  throw new Error("Usage: create-critical-browser-shards.mjs <count>")
}

const timingPath = resolve(
  repositoryRoot,
  "tools/benchmarks/critical-browser-test-timings.json"
)
const timingData = JSON.parse(readFileSync(timingPath, "utf8"))
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const listing = spawnSync(
  pnpmCommand,
  [
    "exec",
    "playwright",
    "test",
    "--grep",
    "@critical",
    "--list",
    "--reporter=list"
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" }
  }
)

if (listing.error) throw listing.error
if (listing.status !== 0) {
  process.stderr.write(listing.stderr ?? "")
  process.stderr.write(listing.stdout ?? "")
  throw new Error(`Playwright test discovery exited with ${listing.status}`)
}

const tests = listing.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("["))
  .map((line) => {
    const parts = line.split(" › ")
    const project = parts[0]?.match(/^\[([^\]]+)\]$/)?.[1]
    if (!project || parts.length < 3) {
      throw new Error(`Cannot parse Playwright test listing: ${line}`)
    }

    const title = parts.slice(2).join(" › ")
    const known = timingData.tests[`${project}|${title}`]
    const weightMs =
      known?.medianMs ?? timingData.projectFallbackMs[project] ?? 10_000

    return { line, project, title, weightMs }
  })

if (tests.length === 0) {
  throw new Error("Playwright test discovery found no @critical tests")
}

const titleCounts = new Map()
for (const test of tests) {
  titleCounts.set(test.title, (titleCounts.get(test.title) ?? 0) + 1)
}
const duplicateTitles = [...titleCounts]
  .filter(([, count]) => count > 1)
  .map(([title]) => title)
if (duplicateTitles.length > 0) {
  throw new Error(
    `Critical test titles must be unique for title-based sharding: ${duplicateTitles.join(", ")}`
  )
}

const bins = Array.from({ length: shardCount }, (_, index) => ({
  shard: index + 1,
  weightMs: 0,
  tests: []
}))

for (const test of tests.sort(
  (left, right) =>
    right.weightMs - left.weightMs || left.line.localeCompare(right.line)
)) {
  const bin = bins.reduce((lightest, candidate) =>
    candidate.weightMs < lightest.weightMs ? candidate : lightest
  )
  bin.tests.push(test)
  bin.weightMs += test.weightMs
}

const assigned = bins.flatMap(({ tests: assignedTests }) => assignedTests)
const assignedLines = new Set(assigned.map(({ line }) => line))
if (assigned.length !== tests.length || assignedLines.size !== tests.length) {
  throw new Error(
    `Shard planning assigned ${assigned.length} unique tests from ${tests.length} discovered tests`
  )
}

const outputDirectory = resolve(
  process.env.CRITICAL_SHARD_OUTPUT_DIR ??
    resolve(repositoryRoot, "artifacts/e2e/critical-shards")
)
mkdirSync(outputDirectory, { recursive: true })

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

for (const bin of bins) {
  const titleAlternation = bin.tests
    .map(({ title }) => escapeRegex(title))
    .join("|")
  const grepPattern = `/(?:^| )(?:${titleAlternation})(?: @critical)?$/`
  const selected = spawnSync(
    pnpmCommand,
    [
      "exec",
      "playwright",
      "test",
      "--grep",
      grepPattern,
      "--list",
      "--reporter=list"
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" }
    }
  )
  if (selected.error) throw selected.error
  if (selected.status !== 0) {
    process.stderr.write(selected.stderr ?? "")
    process.stderr.write(selected.stdout ?? "")
    throw new Error(
      `Playwright validation for shard ${bin.shard} exited with ${selected.status}`
    )
  }

  const selectedKeys = selected.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("["))
    .map((line) => {
      const parts = line.split(" › ")
      const project = parts[0]?.match(/^\[([^\]]+)\]$/)?.[1]
      const title = parts.slice(2).join(" › ")
      return `${project}|${title}`
    })
  const expectedKeys = new Set(
    bin.tests.map(({ project, title }) => `${project}|${title}`)
  )
  if (
    selectedKeys.length !== expectedKeys.size ||
    selectedKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new Error(
      `Playwright selected ${selectedKeys.length} tests for shard ${bin.shard}; expected ${expectedKeys.size}`
    )
  }

  const outputPath = resolve(
    outputDirectory,
    `critical-shard-${bin.shard}-of-${shardCount}.txt`
  )
  writeFileSync(
    outputPath,
    `${bin.tests.map(({ line }) => line).join("\n")}\n`,
    "utf8"
  )
  writeFileSync(
    resolve(
      outputDirectory,
      `critical-shard-${bin.shard}-of-${shardCount}.grep`
    ),
    `${grepPattern}\n`,
    "utf8"
  )

  const usedBaseline = bin.tests.filter((test) =>
    Object.hasOwn(timingData.tests, `${test.project}|${test.title}`)
  ).length
  console.log(
    `Critical browser shard ${bin.shard}/${shardCount}: ${bin.tests.length} tests, ${(bin.weightMs / 1000).toFixed(1)}s estimated (${usedBaseline}/${bin.tests.length} with historical timings); Playwright selection verified.`
  )
}
