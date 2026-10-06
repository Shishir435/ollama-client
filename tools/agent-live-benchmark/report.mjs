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

/** Correctness, settlement and failure origin are independent inputs. */
export const classifyAttempt = ({
  status,
  success,
  expectedStatus = "completed",
  expectedPause = false,
  pauseReason,
  errorCode,
  infrastructureFailure,
  providerFailure,
  siteBlocked,
  admissionFailure
}) => {
  if (infrastructureFailure) return "infrastructure_failure"
  if (status === "completed" || status === "answered_in_chat")
    return success === true ? "achieved" : "false_completion"
  if (status === "paused" && expectedPause && success === true)
    return "safely_handed_off"
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
  return "partial"
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
  return {
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
      .sort((a, b) => b.count - a.count || a.failure.localeCompare(b.failure))
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
  "reviewDisagreements"
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
  "executionPath"
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
  if (typeof row.success === "boolean") safe.success = row.success
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
    "Token counts are provider-reported when available; unknown usage and prices remain absent.",
    ""
  ].join("\n")
