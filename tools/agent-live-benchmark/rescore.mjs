import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { attemptTimedOut } from "./attempt-deadline.mjs"
import { QUALIFICATION_TASKS } from "./qualification-corpus.mjs"
import { qualificationDiagnostics } from "./qualification-report.mjs"
import { countForbiddenEffects } from "./qualification-score.mjs"
import {
  classifyAttempt,
  failureOrigin,
  hashFiles,
  successClaim,
  wireTelemetry,
  writeBaseline
} from "./report.mjs"
import { isSiteChallenge } from "./score-answer.mjs"

/**
 * Classifies a finished attempt again from its private evidence, with the
 * scorer as it is now. A classification fix then reaches a pass already run
 * instead of costing another one. The oracle's `success` is kept as recorded:
 * it came from server state at the time and cannot be recomputed afterwards.
 * Attempts the harness never ran, or that threw, keep their row unchanged.
 */
export const rescoreAttempt = (row, evidence, { taskTimeoutMs } = {}) => {
  const recorded = evidence?.row
  if (!recorded || evidence.harnessError) return row
  const { status, success, answer, errorCode, pauseReason } = recorded
  const goal = recorded.goal ?? row.goal
  const wire = evidence.wire ?? []
  const admissionFailure =
    status === "turn_not_started" ||
    (!evidence.finalRun &&
      recorded.delegated !== true &&
      wireTelemetry(wire).executionStages.includes("browser_task_admission"))
  const deadlineReached =
    recorded.harnessTimedOut === true ||
    (Number.isFinite(taskTimeoutMs) &&
      evidence.timing?.ended - evidence.timing?.sentAt >= taskTimeoutMs)
  const timedOut = attemptTimedOut({ status, deadlineReached })
  const verdict = classifyAttempt({
    status,
    success,
    answer,
    goal,
    expectedPause: recorded.expectedPause,
    pauseReason,
    errorCode,
    infrastructureFailure:
      status === "harness_invalid" ||
      timedOut ||
      wire.some((record) => record.budgetBlocked),
    admissionFailure,
    providerFailure: wire.some((rec) => rec.status >= 400),
    siteBlocked: isSiteChallenge(evidence.body),
    unclearOracle: evidence.scored?.unclear === true
  })
  const task = QUALIFICATION_TASKS.find((task) => task.id === row.task)
  const forbiddenEffects =
    task && Array.isArray(evidence.qualificationState?.effects)
      ? countForbiddenEffects({ ...evidence.qualificationState, task })
      : row.forbiddenEffects
  return {
    ...row,
    ...(forbiddenEffects === undefined ? {} : { forbiddenEffects }),
    verdict,
    ...(timedOut
      ? { harnessTimedOut: true, failureCode: "harness_timeout" }
      : {}),
    successClaimed: successClaim({ status, answer, goal }),
    failureOrigin: failureOrigin({ verdict, status, errorCode })
  }
}

/**
 * Re-scores a pass directory in place: baseline.json, baseline.md and, for a
 * qualification pass, qualification.json. Records which verdicts moved.
 */
export const rescorePass = (directory) => {
  const report = JSON.parse(
    readFileSync(join(directory, "baseline.json"), "utf8")
  )
  const changed = []
  const rows = report.attempts.map((row) => {
    const path = join(
      directory,
      `${row.task}-${row.attempt}`,
      "local-debug",
      "evidence.json"
    )
    if (!existsSync(path)) return row
    const next = rescoreAttempt(row, JSON.parse(readFileSync(path, "utf8")), {
      taskTimeoutMs: report.inputs.budgets?.taskTimeoutMs
    })
    if (next.verdict !== row.verdict)
      changed.push({
        task: row.task,
        attempt: row.attempt,
        from: row.verdict,
        to: next.verdict
      })
    return next
  })
  const inputs = {
    ...report.inputs,
    rescored: {
      at: new Date().toISOString(),
      scorerHash: hashFiles([
        "tools/agent-live-benchmark/rescore.mjs",
        "tools/agent-live-benchmark/attempt-deadline.mjs",
        "tools/agent-live-benchmark/qualification-corpus.mjs",
        "tools/agent-live-benchmark/qualification-report.mjs",
        "tools/agent-live-benchmark/qualification-fixtures.mjs",
        "tools/agent-live-benchmark/qualification-traps.mjs",
        "tools/agent-live-benchmark/report.mjs",
        "tools/agent-live-benchmark/score-answer.mjs",
        "tools/agent-live-benchmark/qualification-score.mjs"
      ]),
      changed
    }
  }
  const rescored = writeBaseline(directory, inputs, rows)
  if (report.inputs.qualification)
    writeFileSync(
      join(directory, "qualification.json"),
      JSON.stringify(qualificationDiagnostics(rescored), null, 2)
    )
  return changed
}

/** Usage: rescore.mjs <pass directory>... */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directories = process.argv.slice(2)
  if (!directories.length)
    throw new Error("Pass one or more benchmark pass directories")
  for (const directory of directories) {
    if (!readdirSync(directory).includes("baseline.json"))
      throw new Error(`${directory} has no baseline.json`)
    const changed = rescorePass(directory)
    console.log(JSON.stringify({ directory, changed }, null, 2))
  }
}
