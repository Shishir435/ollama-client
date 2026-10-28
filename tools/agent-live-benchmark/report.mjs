import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs"
import { join } from "node:path"
import { classifyClaim } from "./score-answer.mjs"

/** Hash recorded corpus/config bytes, rather than a mutable version label alone. */
export const hashFiles = (paths) => {
  const hash = createHash("sha256")
  for (const path of [...paths].sort()) {
    hash.update(path).update("\0").update(readFileSync(path)).update("\0")
  }
  return hash.digest("hex")
}

/** Fingerprint the exact built extension, including manifest and emitted runtime. */
const artifactHash = (directory) => {
  if (!directory || !existsSync(directory)) return undefined
  const walk = (path) =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(path, entry.name))
        : [join(path, entry.name)]
    )
  return hashFiles(walk(directory))
}

/** Inputs pinned before a pass; secrets and provider URLs never enter this record. */
export const baselineInputs = ({
  corpusFiles,
  provider,
  model,
  reasoningEffort,
  visionMode,
  budgets,
  policy,
  buildDirectory
}) => ({
  candidateSha: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8"
  }).trim(),
  dirty: Boolean(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
      encoding: "utf8"
    }).trim()
  ),
  artifactHash: artifactHash(buildDirectory),
  corpusVersion: "current-head-v1",
  corpusHash: hashFiles(corpusFiles),
  provider,
  model,
  reasoningEffort: reasoningEffort ?? "provider_default",
  visionMode,
  budgets,
  policy,
  policySourceHash: hashFiles([
    "packages/contracts/src/agent.ts",
    "packages/agent-runtime/src/budgets.ts",
    "packages/agent-runtime/src/policy.ts"
  ])
})

/**
 * Whether the user was told the task succeeded. A completed run claims it
 * through its own verdict; otherwise the chat reply is what the user reads.
 */
/**
 * A completion with answers the runtime did not check is still a completion
 * the run reported: the user is told the task is done, with a caveat. It is
 * scored as a claim, so a wrong one is a false completion like any other.
 */
const COMPLETED_STATUSES = new Set(["completed", "completed_unverified"])

export const successClaim = ({ status, answer, goal }) =>
  COMPLETED_STATUSES.has(status) ? "claimed" : classifyClaim(answer, { goal })

/**
 * Three answers kept apart: whether the goal was attained (`success`, from
 * the oracle), whether success was claimed (the run status or the chat
 * reply), and where a failure came from. A false completion is a claim the
 * oracle contradicts. An honest refusal or a report of partial progress is a
 * failure, never a false completion, and a reply that says both is left for
 * a person to adjudicate.
 */
export const classifyAttempt = ({
  status,
  success,
  answer,
  goal,
  expectedStatus = "completed",
  expectedPause = false,
  pauseReason,
  errorCode,
  infrastructureFailure,
  providerFailure,
  siteBlocked,
  admissionFailure,
  unclearOracle,
  hedgedOnly
}) => {
  if (infrastructureFailure) return "infrastructure_failure"
  const claim = successClaim({ status, answer, goal })
  if (claim === "unsure") return "pending_adjudication"
  /** Admission is resolved before interpreting a standalone chat answer. */
  if (
    admissionFailure ||
    ["not-started", "turn_not_started", "browser_task_not_started"].includes(
      status
    )
  ) {
    if (success !== true && claim === "claimed") return "false_completion"
    return "admission_failure"
  }
  /** The scorer could not tell right from wrong: a person decides. */
  if (unclearOracle && success !== true) return "pending_adjudication"
  /** Wrong only for saying it was unchecked: the honest partial it is. */
  if (success !== true && hedgedOnly === true) return "partial"
  if (COMPLETED_STATUSES.has(status))
    return success === true ? "achieved" : "false_completion"
  if (status === "answered_in_chat" && success === true && claim === "claimed")
    return "achieved"
  if (status === "paused" && expectedPause && success === true)
    return "safely_handed_off"
  if (success !== true && claim === "claimed") return "false_completion"
  if (pauseReason === "unresolved_effect") return "unresolved_effect"
  if (siteBlocked) return "site_blockage"
  if (
    providerFailure ||
    [
      "provider_failed",
      "provider_unavailable",
      "model_incompatible",
      "model_unavailable"
    ].includes(errorCode)
  )
    return "provider_failure"
  if (
    status === "awaiting_takeover" ||
    (success === true &&
      status === expectedStatus &&
      expectedStatus !== "completed")
  )
    return "safely_handed_off"
  if (status === "answered_in_chat") return "reported_failure"
  return "partial"
}

const ACTION_ERRORS = [
  "budget_exhausted",
  "command_refused",
  "observation_failed",
  "policy_blocked",
  "stale_snapshot",
  "unsupported_page"
]

/**
 * The stage a failed attempt broke in: admission, plan, action,
 * verification, report or infrastructure. Undefined for an attempt that
 * needs no explanation (achieved, safely handed off) or one still awaiting
 * adjudication.
 */
export const failureOrigin = ({ verdict, status, errorCode }) => {
  if (
    ["achieved", "safely_handed_off", "pending_adjudication"].includes(verdict)
  )
    return undefined
  if (
    ["infrastructure_failure", "provider_failure", "site_blockage"].includes(
      verdict
    )
  )
    return "infrastructure"
  if (verdict === "admission_failure") return "admission"
  /** A run that verified itself wrongly, or a chat that misreported a run. */
  if (verdict === "false_completion")
    return COMPLETED_STATUSES.has(status) ? "verification" : "report"
  if (errorCode === "model_unavailable") return "infrastructure"
  if (errorCode === "invalid_decision") return "plan"
  if (["verification_failed", "goal_failed"].includes(errorCode))
    return "verification"
  if (ACTION_ERRORS.includes(errorCode)) return "action"
  /** The chat answered without delegating, and did not do the task. */
  if (status === "answered_in_chat") return "plan"
  return "action"
}

/** Recompute every count from all attempt rows, including void and failed attempts. */
export const summarizeBaseline = (attempts) => {
  const count = (rows) =>
    Object.fromEntries(
      [...new Set(rows.map((r) => r.verdict))]
        .sort()
        .map((v) => [v, rows.filter((r) => r.verdict === v).length])
    )
  /** Retained for report compatibility; void attempts are never excluded. */
  const qualified = attempts
  const failures = new Map()
  for (const row of attempts) {
    if (["achieved", "safely_handed_off"].includes(row.verdict)) continue
    const reason =
      safeLabel(row.errorCode ?? row.pauseReason ?? row.failureCode) ??
      row.verdict
    const key = `${row.verdict}/${reason}`
    failures.set(key, (failures.get(key) ?? 0) + 1)
  }
  const origins = new Map()
  for (const row of attempts)
    if (row.failureOrigin)
      origins.set(row.failureOrigin, (origins.get(row.failureOrigin) ?? 0) + 1)
  return {
    /** First on purpose: one false completion outweighs any success rate. */
    falseCompletions: attempts.filter((r) => r.verdict === "false_completion")
      .length,
    goalsAttained: attempts.filter((r) => r.success === true).length,
    successClaims: attempts.filter((r) => r.successClaimed === "claimed")
      .length,
    voidAttempts: attempts.filter((r) => r.verdict === "infrastructure_failure")
      .length,
    pendingAdjudication: attempts.filter(
      (r) => r.verdict === "pending_adjudication"
    ).length,
    endToEnd: { denominator: attempts.length, outcomes: count(attempts) },
    infrastructureQualified: {
      denominator: qualified.length,
      outcomes: count(qualified)
    },
    fulfilledButUnsettled: attempts.filter(
      (r) =>
        r.success === true &&
        !["achieved", "safely_handed_off"].includes(r.verdict)
    ).length,
    rankedFailures: [...failures]
      .map(([failure, count]) => ({ failure, count }))
      .sort((a, b) => b.count - a.count || a.failure.localeCompare(b.failure)),
    failureOrigins: Object.fromEntries([...origins].sort())
  }
}

const safeLabel = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_./:-]{1,120}$/.test(value)
    ? value
    : undefined
const numericKeys = [
  "attempt",
  "steps",
  "observations",
  "modelCalls",
  "activeMs",
  "humanWaitMs",
  "wallMs",
  "approvalsAsked",
  "approvalsGranted",
  "interventions",
  "promptTokens",
  "completionTokens",
  "planningCalls",
  "runtimeCalls",
  "chatCalls",
  "decideMs",
  "observeMs",
  "verifyMs",
  "reviews",
  "reviewMs",
  "reviewDisagreements",
  "recoveries",
  "reviewPromptTokens",
  "reviewOutputTokens",
  "duplicateEffects",
  "forbiddenEffects",
  "unauthorizedDisclosures"
]
const labelKeys = [
  "task",
  "scenario",
  "family",
  "backend",
  "status",
  "verdict",
  "pauseReason",
  "errorCode",
  "failureCode",
  "expectedStatus",
  "executionPath",
  "split",
  "predicate",
  "adjudication",
  "successClaimed",
  "failureOrigin"
]

/** Closed projection: free-form answers, URLs, commands, errors and wire cannot leak. */
export const shareableAttempt = (row) => {
  const safe = {}
  for (const key of labelKeys) {
    const value =
      ["errorCode", "failureCode", "pauseReason"].includes(key) &&
      !/^[a-zA-Z0-9_:-]{1,120}$/.test(String(row[key]))
        ? undefined
        : safeLabel(row[key])
    if (value) safe[key] = value
  }
  for (const key of numericKeys)
    if (Number.isFinite(row[key]) && row[key] >= 0) safe[key] = row[key]
  if (typeof row.harnessTimedOut === "boolean")
    safe.harnessTimedOut = row.harnessTimedOut
  if (typeof row.faultInjected === "boolean")
    safe.faultInjected = row.faultInjected
  if (typeof row.success === "boolean") safe.success = row.success
  if (typeof row.renderedCanvasScreenshot === "boolean")
    safe.renderedCanvasScreenshot = row.renderedCanvasScreenshot
  if (Array.isArray(row.executionStages))
    safe.executionStages = row.executionStages.map(safeLabel).filter(Boolean)
  return safe
}

/**
 * Whether the provider failed this attempt. A fault the harness injected is
 * one the agent must recover from, so it is never the provider's failure; the
 * live runners and `rescore` both ask here, or a pass classified again would
 * move an agent failure into infrastructure.
 */
export const providerFailed = (wire) =>
  wire.some((record) => record.status >= 400 && !record.injected)

/** Failure codes the runner records when the provider refused the attempt. */
const PROVIDER_REFUSAL_CODES = ["provider_refused", "provider_rate_limited"]

/** Whether an attempt's recorded row says the provider refused it outright. */
export const refusedByProvider = (row) =>
  PROVIDER_REFUSAL_CODES.includes(row?.failureCode)

/** Phase routes and usage from actual requests/responses, never inferred model prices. */
export const wireTelemetry = (wire) => {
  const calls = wire.filter((w) => w.path?.endsWith("/chat/completions"))
  const toolNames = (w) => (w.request?.tools ?? []).map((t) => t.function?.name)
  const planningCalls = calls.filter((w) =>
    toolNames(w).includes("agent_plan")
  ).length
  const runtimeCalls = calls.filter((w) =>
    toolNames(w).includes("agent_decision")
  ).length
  const stages = new Set(["direct_chat"])
  let promptTokens, completionTokens
  for (const w of calls) {
    const text = JSON.stringify(w.request?.messages ?? [])
    for (const name of ["current_tab", "read_tab", "browser_task"])
      if (text.includes(`"name":"${name}"`))
        stages.add(name === "browser_task" ? "browser_task_admission" : name)
    const frames = String(w.response ?? "")
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => {
        try {
          return JSON.parse(l.slice(6))
        } catch {
          return undefined
        }
      })
    const usage = frames.findLast((f) => f?.usage)?.usage
    if (Number.isFinite(usage?.prompt_tokens))
      promptTokens = (promptTokens ?? 0) + usage.prompt_tokens
    if (Number.isFinite(usage?.completion_tokens))
      completionTokens = (completionTokens ?? 0) + usage.completion_tokens
  }
  if (planningCalls) stages.add("planning")
  if (runtimeCalls) stages.add("runtime_execution")
  return {
    modelCalls: calls.length,
    planningCalls,
    runtimeCalls,
    chatCalls: calls.length - planningCalls - runtimeCalls,
    executionStages: [...stages],
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens })
  }
}

/** Count distinct attention requests and integrate their observed wait intervals. */
export const supervisionTelemetry = (messages, started, ended) => {
  const approvals = new Set(),
    interventions = new Set()
  let humanWaitMs = 0,
    previous = started,
    waiting = false
  for (const m of messages) {
    const at = Math.min(ended, Math.max(started, m.at ?? previous))
    if (waiting) humanWaitMs += Math.max(0, at - previous)
    const snapshot = m.snapshot
    if (!snapshot) continue
    const pending = snapshot.pending
    if (pending?.kind === "approval") approvals.add(pending.request.id)
    if (pending && pending.kind !== "approval")
      interventions.add(
        `${pending.kind}:${pending.request?.id ?? snapshot.run?.pausedAt ?? "unknown"}`
      )
    waiting = ["awaiting_approval", "awaiting_takeover", "paused"].includes(
      snapshot.run?.status
    )
    previous = at
  }
  if (waiting) humanWaitMs += Math.max(0, ended - previous)
  return {
    wallMs: ended - started,
    humanWaitMs,
    activeMs: Math.max(0, ended - started - humanWaitMs),
    approvalsAsked: approvals.size,
    interventions: interventions.size
  }
}

/** Save raw local evidence only by explicit opt-in; summaries always remain shareable. */
export const writeBaseline = (directory, inputs, rows) => {
  mkdirSync(directory, { recursive: true })
  const attempts = rows.map(shareableAttempt)
  const report = {
    schemaVersion: 1,
    inputs,
    attempts,
    summary: summarizeBaseline(attempts)
  }
  writeFileSync(
    join(directory, "baseline.json"),
    JSON.stringify(report, null, 2)
  )
  writeFileSync(join(directory, "baseline.md"), renderBaseline(report))
  return report
}

/** "1:05" from milliseconds; blank when the attempt kept no time. */
const duration = (ms) => {
  if (!Number.isFinite(ms)) return ""
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const passed = (row) => row.success === true

/**
 * Why an attempt did not pass, in the report's own labels: the verdict, then
 * the most specific code the attempt kept.
 */
const failureReason = (row) =>
  [row.verdict, row.errorCode ?? row.pauseReason ?? row.failureCode]
    .filter(Boolean)
    .join("/")

/** Pass counts per task family, in the order the families first ran. */
const familyTotals = (attempts) => {
  const families = new Map()
  for (const row of attempts) {
    const family = row.family ?? "other"
    const total = families.get(family) ?? { passed: 0, attempts: 0 }
    total.attempts += 1
    if (passed(row)) total.passed += 1
    families.set(family, total)
  }
  return [...families]
}

const taskLabel = (row, attempts) =>
  attempts.some((other) => other !== row && other.task === row.task)
    ? `${row.task} #${row.attempt ?? 1}`
    : (row.task ?? "")

/**
 * Per-task and per-family tables, so a run can be read without the JSON.
 * Pass is the scorer's verdict on the site's end state; Settled is how the
 * run itself ended, which is why a passing task can still read "paused".
 */
const renderAttempts = (attempts) => [
  "## By family",
  "",
  "| Family | Passed |",
  "| --- | ---: |",
  ...familyTotals(attempts).map(
    ([family, total]) => `| ${family} | ${total.passed}/${total.attempts} |`
  ),
  "",
  "## By task",
  "",
  "| Task | Result | Settled | Claimed done | Failure | Steps | Time |",
  "| --- | --- | --- | --- | --- | ---: | ---: |",
  ...attempts.map(
    (row) =>
      `| ${taskLabel(row, attempts)} | ${passed(row) ? "pass" : "**fail**"} | ${row.status ?? ""} | ${row.successClaimed === "claimed" ? "yes" : "no"} | ${passed(row) ? "" : failureReason(row)} | ${row.steps ?? ""} | ${duration(row.wallMs)} |`
  ),
  ""
]

/**
 * The run's outcome as plain lines for the terminal: one line per attempt,
 * totals per family, then the headline counts and where the report is.
 */
export const renderConsoleSummary = (report, directory) => {
  const { attempts, summary } = report
  const width = Math.max(
    4,
    ...attempts.map((row) => taskLabel(row, attempts).length)
  )
  const passes = attempts.filter(passed).length
  return [
    "",
    "Benchmark summary",
    "",
    ...attempts.map((row) =>
      [
        passed(row) ? "PASS" : "FAIL",
        taskLabel(row, attempts).padEnd(width),
        (row.status ?? "").padEnd(22),
        row.successClaimed === "claimed" ? "claimed " : "        ",
        duration(row.wallMs).padStart(6),
        passed(row) ? "" : `  ${failureReason(row)}`
      ]
        .join("  ")
        .trimEnd()
    ),
    "",
    ...familyTotals(attempts).map(
      ([family, total]) => `  ${family}: ${total.passed}/${total.attempts}`
    ),
    "",
    `Passed ${passes}/${attempts.length}. False completions: ${summary.falseCompletions ?? 0}. Pending adjudication: ${summary.pendingAdjudication ?? 0}.`,
    `Candidate ${String(report.inputs?.candidateSha ?? "").slice(0, 8)}; report: ${join(directory, "baseline.md")}`,
    ""
  ].join("\n")
}

/** The report is reproducible from the saved inputs and attempt outcomes alone. */
export const renderBaseline = ({ inputs, summary, attempts }) =>
  [
    "# Current-head browser-agent baseline",
    "",
    `Candidate: ${inputs.candidateSha}; corpus: ${inputs.corpusVersion}/${inputs.corpusHash}.`,
    "",
    `**False completions: ${summary.falseCompletions ?? 0}.** Pending adjudication: ${summary.pendingAdjudication ?? 0}.`,
    "",
    `End-to-end denominator: ${summary.endToEnd.denominator}. Void attempts: ${summary.voidAttempts ?? 0}; all remain in the denominator.`,
    "",
    "| Verdict | End-to-end | Infrastructure-qualified |",
    "| --- | ---: | ---: |",
    ...Object.keys(summary.endToEnd.outcomes).map(
      (v) =>
        `| ${v} | ${summary.endToEnd.outcomes[v]} | ${summary.infrastructureQualified.outcomes[v] ?? 0} |`
    ),
    "",
    `Fulfilled but unsettled: ${summary.fulfilledButUnsettled}.`,
    "",
    "| Ranked failure | Count |",
    "| --- | ---: |",
    ...summary.rankedFailures.map((r) => `| ${r.failure} | ${r.count} |`),
    "",
    "| Failure origin | Count |",
    "| --- | ---: |",
    ...Object.entries(summary.failureOrigins ?? {}).map(
      ([origin, count]) => `| ${origin} | ${count} |`
    ),
    "",
    "Token counts are provider-reported when available; unknown usage and prices remain absent.",
    "",
    ...(attempts?.length ? renderAttempts(attempts) : [])
  ].join("\n")
