/**
 * The conditions a pass runs the extension under that are not the model: the
 * settings the harness seeds into the extension, and how its own approver
 * answers. Both runners seed and record through here, so what a report says
 * was in force is what was applied.
 */

/**
 * Bounds of `SETTINGS.AGENT_CONTEXT_WINDOW`
 * (`AGENT_CONTEXT_MIN_TOKENS` and `AGENT_CONTEXT_MAX_TOKENS` in
 * `src/application/agent/agent-context-window.ts`). The extension's parser
 * drops a value outside them and reads the setting as `auto`, so an
 * out-of-range request is refused here instead of being recorded as applied.
 */
const CONTEXT_WINDOW_MIN = 8_192
const CONTEXT_WINDOW_MAX = 131_072

/**
 * `AUDIT_CONTEXT_WINDOW` as the extension setting it seeds: "auto", an integer
 * token count in range, or undefined when unset, which leaves the extension's
 * own default. A hosted model behind a loopback proxy is the case for setting
 * it: `auto` cannot know the window is remote.
 */
export const parseContextWindow = (value) => {
  const text = String(value ?? "").trim()
  if (!text) return undefined
  if (text === "auto") return "auto"
  const tokens = /^\d+$/.test(text) ? Number(text) : Number.NaN
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < CONTEXT_WINDOW_MIN ||
    tokens > CONTEXT_WINDOW_MAX
  )
    throw new Error(
      `AUDIT_CONTEXT_WINDOW must be "auto" or an integer from ${CONTEXT_WINDOW_MIN} to ${CONTEXT_WINDOW_MAX}`
    )
  return tokens
}

/**
 * The device-local settings seeded before a pass, as the storage layer holds
 * them: each value JSON-encoded under its registered key. The agent is opt-in
 * and the permission mode is the routine one, which the baseline pins.
 */
export const agentLocalSettings = ({ contextWindow } = {}) => ({
  "agent-enabled-v1": JSON.stringify(true),
  "agent-permission-mode-v1": JSON.stringify("allow_routine"),
  ...(contextWindow === undefined
    ? {}
    : { "agent-context-window-v1": JSON.stringify(contextWindow) })
})

/**
 * What a report records about the conditions. The resolved window is known
 * only for an explicit number, which the extension honours as stated; under
 * `auto` it depends on the provider's metadata and the evidence export does
 * not carry the figure, so it is recorded as not exposed rather than guessed.
 * `approvalScope` is "task_origins" when the approver answers only requests
 * for the task's own origins (any other is left unanswered), else "any_origin".
 */
export const runConditions = ({ contextWindow, approvalScope }) => ({
  approvalPolicy: {
    mode: "automatic",
    decision: "approve",
    scope: approvalScope,
    ...(approvalScope === "task_origins" ? { outOfScope: "unanswered" } : {})
  },
  agentContextWindow: {
    setting: contextWindow ?? "auto",
    applied:
      contextWindow === undefined
        ? "extension_default"
        : "AUDIT_CONTEXT_WINDOW",
    resolved:
      typeof contextWindow === "number"
        ? { tokens: contextWindow, source: "user" }
        : { source: "not_exposed" }
  },
  durableReceipts: "unobserved"
})
