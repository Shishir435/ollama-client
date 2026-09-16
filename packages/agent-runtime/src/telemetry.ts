import type { AgentStepTelemetry } from "@ollama-client/contracts"
import { agentStepTelemetry } from "@ollama-client/contracts"

/**
 * Fields that describe work done, so two records of the same step add up.
 *
 * A step is measured in pieces by whoever can see each one — the observation
 * port times its own read, the model port reports the provider's usage, the
 * executor times the effect — and the pieces arrive at different moments. A
 * merge that overwrote would report only whichever piece landed last.
 */
const ADDITIVE = [
  "decideMs",
  "observeMs",
  "captureMs",
  "resolveMs",
  "executeMs",
  "verifyMs",
  "persistMs",
  "observations",
  "retries",
  "promptTokens",
  "outputTokens",
  "promptTokensEstimated",
  "loadMs",
  "prefillMs",
  "decodeMs"
] as const satisfies readonly (keyof AgentStepTelemetry)[]

/**
 * Fields that describe the request rather than the work, so the most recent
 * answer is the true one. Summing `numCtx` across a step's two receipts would
 * report a window twice the size of the one actually asked for.
 */
const LATEST = [
  "numCtx",
  "promptChars",
  "firstTokenMs"
] as const satisfies readonly (keyof AgentStepTelemetry)[]

const add = (a?: number, b?: number): number | undefined =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)

/**
 * Combines what two measurements of one step each saw. Absent stays absent
 * rather than becoming zero, because an unmeasured phase and a phase that
 * took no time are different claims.
 */
export const mergeAgentStepTelemetry = (
  base: AgentStepTelemetry | undefined,
  next: AgentStepTelemetry | undefined
): AgentStepTelemetry | undefined => {
  if (!base) return next
  if (!next) return base
  const merged: Record<string, number | boolean | undefined> = {}
  for (const key of ADDITIVE) merged[key] = add(base[key], next[key])
  for (const key of LATEST) merged[key] = next[key] ?? base[key]
  if (base.screenshot === true || next.screenshot === true) {
    merged.screenshot = true
  }
  return agentStepTelemetry(merged as AgentStepTelemetry)
}
