import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { evaluateRelease } from "./release-gate.mjs"
import { artifactHash, scorerHash } from "./report.mjs"

/**
 * Usage: release.mjs <sha> [--budget <usd>] [--baseline <report.json>]...
 * [--build <directory>] <qualification.json>...
 * `--build` is the candidate's own build, `build/chrome-mv3-prod` by default;
 * the reports must name the hash of exactly that build. A missing directory
 * leaves the artifact unverified, which blocks.
 * Without a budget and matched baselines the cost and intervention blockers
 * stay, by design: absent evidence is never read as qualifying.
 */
const args = process.argv.slice(2)
const candidate = args.shift()
const paths = []
const baselinePaths = []
let costBudgetUsd
let buildDirectory = "build/chrome-mv3-prod"
while (args.length) {
  const arg = args.shift()
  if (arg === "--budget") {
    /** `Number("")` is 0, so an unset shell variable must not become a budget. */
    const budget = args.shift()
    if (!budget?.trim())
      throw new Error("--budget takes a non-negative US dollar amount")
    costBudgetUsd = Number(budget)
    if (!Number.isFinite(costBudgetUsd) || costBudgetUsd < 0)
      throw new Error("--budget takes a non-negative US dollar amount")
  } else if (arg === "--build") {
    const path = args.shift()
    if (!path) throw new Error("--build takes a build directory")
    buildDirectory = path
  } else if (arg === "--baseline") {
    const path = args.shift()
    if (!path) throw new Error("--baseline takes a report path")
    baselinePaths.push(path)
  } else paths.push(arg)
}
if (paths.length < 2)
  throw new Error(
    "Pass the exact release SHA and qualification.json paths for two models"
  )
/**
 * The scorer hash and the build are read from this checkout, so they speak for
 * the candidate only when this checkout is the candidate, untouched.
 */
const git = (...gitArgs) =>
  execFileSync("git", gitArgs, { encoding: "utf8" }).trim()
if (git("rev-parse", "HEAD") !== candidate)
  throw new Error(
    "Check out the candidate SHA before running the gate: its scorer is read from this checkout"
  )
if (git("status", "--porcelain", "--untracked-files=normal"))
  throw new Error(
    "The checkout has uncommitted changes; the gate needs the candidate as committed"
  )
const read = (path) => JSON.parse(readFileSync(path, "utf8"))
const result = evaluateRelease(paths.map(read), candidate, {
  ...(costBudgetUsd === undefined ? {} : { costBudgetUsd }),
  baselineReports: baselinePaths.map(read),
  ...(existsSync(buildDirectory)
    ? { artifactHash: artifactHash(buildDirectory) }
    : {}),
  scorerHash: scorerHash()
})
console.log(JSON.stringify(result, null, 2))
if (!result.promotionReady) process.exitCode = 1
