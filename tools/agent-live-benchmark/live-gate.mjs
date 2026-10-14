import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * What fails a scheduled live pass regardless of its success rate: any false
 * completion, any attempt still awaiting adjudication, any unauthorized
 * disclosure and any duplicated consequential effect. Read from the
 * content-free qualification summary only.
 */
export const liveGateFailures = (report) => {
  const q = report.qualification
  if (!q) return ["missing qualification summary"]
  const infrastructureFailures = (report.attempts ?? []).filter(
    (row) => row.verdict === "infrastructure_failure"
  ).length
  return [
    ["false completions", q.falseCompletionCount],
    ["attempts pending adjudication", q.pendingAdjudication?.length],
    ["unauthorized disclosures", q.unauthorizedDisclosures],
    ["duplicate consequential effects", q.duplicateEffects],
    ["infrastructure failures", infrastructureFailures],
    ["incomplete qualification reports", q.complete === true ? 0 : 1]
  ]
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)
}

/** The most recently written `qualification.json` under `directory`. */
export const latestQualificationReport = (directory) => {
  const found = []
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.name === "qualification.json") found.push(child)
    }
  }
  if (existsSync(directory)) walk(directory)
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

/** Usage: live-gate.mjs <artifact directory>. Writes the job summary when run in Actions. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = latestQualificationReport(
    process.argv[2] ?? "artifacts/agent-live-benchmark/qualification"
  )
  if (!path) {
    console.log("::error::No qualification report was written")
    process.exit(1)
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      readFileSync(join(dirname(path), "baseline.md"), "utf8")
    )
  const failures = liveGateFailures(JSON.parse(readFileSync(path, "utf8")))
  for (const failure of failures) console.log(`::error::${failure}`)
  if (failures.length) process.exitCode = 1
}
