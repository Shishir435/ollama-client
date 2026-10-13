import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Private per-attempt evidence for improving the harness and the agent: what
 * each model call cost and returned, what the fixture server was asked, what
 * the pages and the panel reported, and a one-line digest of every attempt
 * that did not succeed. It stays under `local-debug/` in the gitignored
 * artifacts and is never part of the shareable baseline.
 */

/** Keys whose values are bulk image data or credentials, never kept. */
const REDACTED_KEYS = new Set([
  "image_url",
  "image",
  "images",
  "screenshot",
  "authorization",
  "Authorization",
  "apiKey"
])

export const redactEvidence = (_key, value) =>
  REDACTED_KEYS.has(_key) ? "[REDACTED]" : value

const phaseOf = (request) => {
  const names = (request?.tools ?? []).map((tool) => tool.function?.name)
  if (names.includes("agent_decision")) return "decision"
  if (names.includes("agent_plan")) return "planning"
  if (names.includes("agent_completion_review")) return "review"
  return names.includes("browser_task") ? "chat" : "other"
}

/** The SSE data frames of a streamed response; a cut line is skipped. */
const frames = (response) =>
  String(response ?? "")
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .flatMap((line) => {
      try {
        return [JSON.parse(line.slice(6))]
      } catch {
        return []
      }
    })

/**
 * Tool calls a streamed response made, reassembled from their fragments.
 * OpenAI-style streams send the arguments in pieces under one index.
 */
export const streamedToolCalls = (response) => {
  const calls = new Map()
  for (const frame of frames(response))
    for (const call of frame.choices?.[0]?.delta?.tool_calls ?? []) {
      const index = call.index ?? calls.size
      const known = calls.get(index) ?? { name: "", arguments: "" }
      if (call.function?.name) known.name = call.function.name
      if (call.function?.arguments) known.arguments += call.function.arguments
      calls.set(index, known)
    }
  return [...calls.values()]
}

/** Text a streamed response carried, outside any tool call. */
const streamedText = (response) =>
  frames(response)
    .map((frame) => frame.choices?.[0]?.delta?.content ?? "")
    .join("")

const clip = (text, limit) =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`

/**
 * One row per model call, offset from the attempt's start: phase, status,
 * retries, duration, usage, finish reason and the tool it called. Enough to
 * see where an attempt's time and tokens went without reading the wire.
 */
export const callTimeline = (wire, startedAt) =>
  wire
    .filter((rec) => rec.path?.endsWith("/chat/completions"))
    .map((rec) => {
      const all = frames(rec.response)
      const usage = all.findLast((frame) => frame?.usage)?.usage
      const finish = all.findLast((frame) => frame?.choices?.[0]?.finish_reason)
        ?.choices[0].finish_reason
      return {
        phase: phaseOf(rec.request),
        atMs: rec.started - startedAt,
        elapsedMs: rec.elapsedMs,
        status: rec.status,
        ...(rec.retries ? { retries: rec.retries } : {}),
        ...(rec.injected ? { injected: true } : {}),
        ...(usage
          ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens
            }
          : {}),
        ...(finish ? { finish } : {}),
        tools: streamedToolCalls(rec.response).map((call) => call.name)
      }
    })

/**
 * The agent's decisions in order, as the model wrote them: the action and
 * its arguments, clipped. What a failed attempt was trying to do.
 */
export const decisionTrace = (wire, limit = 600) =>
  wire
    .filter((rec) => phaseOf(rec.request) === "decision")
    .flatMap((rec) =>
      streamedToolCalls(rec.response).map((call) => clip(call.arguments, limit))
    )

/**
 * Every request the fixture servers saw during the attempt, with its status
 * once answered. Bound to one attempt: the caller swaps the array.
 */
export const recordFixtureRequest = (log, req, res, external = false) => {
  if (!log) return
  const entry = {
    at: Date.now(),
    method: req.method,
    path: req.url,
    ...(external ? { external: true } : {})
  }
  log.push(entry)
  res.on("finish", () => {
    entry.status = res.statusCode
  })
}

/** A qualification state as plain data: its Set of reads becomes a list. */
export const plainQualificationState = (state) =>
  state
    ? {
        ...state,
        task: { id: state.task.id, family: state.task.family },
        reads: [...(state.reads ?? [])]
      }
    : undefined

/**
 * One line per attempt that did not succeed, for triage across a pass:
 * verdict, origin, the run's own codes, retries, and the last decisions.
 */
export const failureDigest = (row, wire) => ({
  task: row.task,
  attempt: row.attempt,
  verdict: row.verdict,
  failureOrigin: row.failureOrigin,
  successClaimed: row.successClaimed,
  status: row.status,
  errorCode: row.errorCode,
  pauseReason: row.pauseReason,
  failureCode: row.failureCode,
  steps: row.steps,
  retries: wire.reduce((total, rec) => total + (rec.retries ?? 0), 0),
  lastDecisions: decisionTrace(wire, 300).slice(-5),
  answer: clip(String(row.answer ?? ""), 400),
  chatText: clip(
    streamedText(
      wire.filter((rec) => phaseOf(rec.request) === "chat").at(-1)?.response
    ),
    400
  )
})

/** Writes an attempt's evidence files, private to the user. */
export const writeAttemptEvidence = (directory, evidence) => {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  writeFileSync(
    join(directory, "evidence.json"),
    JSON.stringify(evidence, redactEvidence, 2),
    { mode: 0o600 }
  )
}

/** Appends one digest line to the pass's private failure log. */
export const appendFailureDigest = (directory, digest) => {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  appendFileSync(
    join(directory, "failures.jsonl"),
    `${JSON.stringify(digest)}\n`,
    { mode: 0o600 }
  )
}
