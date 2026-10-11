import { readFileSync } from "node:fs"
import { evaluateRelease } from "./release-gate.mjs"

/**
 * Usage: release.mjs <sha> [--budget <usd>] [--baseline <report.json>]...
 * <qualification.json>...
 * Without a budget and matched baselines the cost and intervention blockers
 * stay, by design: absent evidence is never read as qualifying.
 */
const args = process.argv.slice(2)
const candidate = args.shift()
const paths = []
const baselinePaths = []
let costBudgetUsd
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
const read = (path) => JSON.parse(readFileSync(path, "utf8"))
const result = evaluateRelease(paths.map(read), candidate, {
  ...(costBudgetUsd === undefined ? {} : { costBudgetUsd }),
  baselineReports: baselinePaths.map(read)
})
console.log(JSON.stringify(result, null, 2))
if (!result.promotionReady) process.exitCode = 1
