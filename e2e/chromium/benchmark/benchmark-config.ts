import type { ReasoningEffort } from "../../../src/types/model"

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "auto",
  "enabled",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
])

/** Read a live benchmark effort override and reject misspellings up front. */
export const hostedBenchmarkReasoningEffort = ():
  | ReasoningEffort
  | undefined => {
  const value = process.env.AGENT_HOSTED_REASONING_EFFORT
  if (value === undefined || value === "") return undefined
  if (REASONING_EFFORTS.has(value as ReasoningEffort))
    return value as ReasoningEffort
  throw new Error(
    `Invalid AGENT_HOSTED_REASONING_EFFORT '${value}'. Choose one of: ${[
      ...REASONING_EFFORTS
    ].join(", ")}.`
  )
}

/** Keep Nanobrowser's existing medium default unless a pass overrides it. */
export const nanobrowserBenchmarkReasoningEffort = (): ReasoningEffort =>
  hostedBenchmarkReasoningEffort() ?? "medium"
