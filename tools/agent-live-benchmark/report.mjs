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
export const successClaim = ({ status, answer }) =>
  status === "completed" ? "claimed" : classifyClaim(answer)

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
  expectedStatus = "completed",
  expectedPause = false,
  pauseReason,
  errorCode,
  infrastructureFailure,
  providerFailure,
  siteBlocked,
  admissionFailure,
  unclearOracle
}) => {
  if (infrastructureFailure) return "infrastructure_failure"
  /** The scorer could not tell right from wrong: a person decides. */
  if (unclearOracle && success !== true) return "pending_adjudication"
  if (status === "completed")
    return success === true ? "achieved" : "false_completion"
  if (status === "answered_in_chat" && success === true) return "achieved"
  if (status === "paused" && expectedPause && success === true)
    return "safely_handed_off"
  const claim = successClaim({ status, answer })
  if (success !== true && claim === "claimed") return "false_completion"
  if (success !== true && claim === "unsure") return "pending_adjudication"
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
    admissionFailure ||
    ["not-started", "turn_not_started", "browser_task_not_started"].includes(
      status
    )
  )
    return "admission_failure"
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
    return status === "completed" ? "verification" : "report"
  if (errorCode === "model_unavailable") return "infrastructure"
  if (errorCode === "invalid_decision") return "plan"
  if (["verification_failed", "goal_failed"].includes(errorCode))
    return "verification"
  if (ACTION_ERRORS.includes(errorCode)) return "action"
  /** The chat answered without delegating, and did not do the task. */
  if (status === "answered_in_chat") return "plan"
  return "action"
}

/** Recompute every count from attempt rows; infra-qualified excludes only harness failures. */
export const summarizeBaseline = (attempts) => {
  const count = (rows) =>
    Object.fromEntries(
      [...new Set(rows.map((r) => r.verdict))]
        .sort()
        .map((v) => [v, rows.filter((r) => r.verdict === v).length])
    )
  const qualified = attempts.filter(
    (r) => r.verdict !== "infrastructure_failure"
  )
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
  if (typeof row.faultInjected === "boolean")
    safe.faultInjected = row.faultInjected
  if (typeof row.success === "boolean") safe.success = row.success
  if (typeof row.renderedCanvasScreenshot === "boolean")
    safe.renderedCanvasScreenshot = row.renderedCanvasScreenshot
  if (Array.isArray(row.executionStages))
    safe.executionStages = row.executionStages.map(safeLabel).filter(Boolean)
  return safe
}

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

/** The report is reproducible from the saved inputs and attempt outcomes alone. */
export const renderBaseline = ({ inputs, summary }) =>
  [
    "# Current-head browser-agent baseline",
    "",
    `Candidate: ${inputs.candidateSha}; corpus: ${inputs.corpusVersion}/${inputs.corpusHash}.`,
    "",
    `**False completions: ${summary.falseCompletions ?? 0}.** Pending adjudication: ${summary.pendingAdjudication ?? 0}.`,
    "",
    `End-to-end denominator: ${summary.endToEnd.denominator}. Infrastructure-qualified denominator: ${summary.infrastructureQualified.denominator} (only infrastructure failures excluded).`,
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
    ""
  ].join("\n")
