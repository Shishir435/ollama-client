import type { ToolDefinition, ToolRiskLevel } from "../types"

/**
 * Risk-driven approval policy. Replaces the single hardcoded
 * `requiresConfirmation` boundary with a per-risk rule:
 *
 * | risk     | policy                                              |
 * |----------|-----------------------------------------------------|
 * | low      | auto — never prompts                                |
 * | medium   | confirm once per chat (an approval grants the chat) |
 * | high     | confirm each call; "always allow" available         |
 * | critical | always confirm; no grant of any scope offered       |
 *
 * Grants (see `approval-grants.ts` for the persisted "always" scope and the
 * background session-grant map for "this chat") are keyed per tool × origin so
 * a future agent's "click on github.com" never covers "click anywhere".
 */

export type ApprovalScope = "once" | "session" | "always"

/** Origin placeholder for tools that don't act on a specific site. */
export const NO_ORIGIN = "*"

export const approvalGrantKey = (toolName: string, origin?: string): string =>
  `${toolName}::${origin || NO_ORIGIN}`

/**
 * A tool's risk for approval purposes. The legacy `requiresConfirmation` flag
 * forces at least `high`, so tools that predate risk-driven approvals keep
 * their per-call prompt.
 */
export const effectiveRisk = (
  definition: Pick<ToolDefinition, "risk" | "requiresConfirmation"> | undefined
): ToolRiskLevel => {
  const risk = definition?.risk ?? "low"
  if (
    definition?.requiresConfirmation &&
    (risk === "low" || risk === "medium")
  ) {
    return "high"
  }
  return risk
}

/** Scopes the confirmation prompt may offer for a given risk. */
export const allowedScopesForRisk = (risk: ToolRiskLevel): ApprovalScope[] => {
  switch (risk) {
    case "critical":
      return ["once"]
    case "high":
      return ["once", "session", "always"]
    // Per the policy table above, medium caps out at a per-chat grant — a
    // permanent "always" bypass is reserved for tools the user re-confirms
    // often enough (high) to make that trade-off deliberately.
    case "medium":
      return ["once", "session"]
    default:
      return []
  }
}

/**
 * The scope a plain "Allow" applies. Medium risk confirms once per chat, so
 * approving it grants the rest of the chat; high/critical approvals cover only
 * the one call.
 */
export const defaultScopeForRisk = (risk: ToolRiskLevel): ApprovalScope =>
  risk === "medium" ? "session" : "once"

export interface GrantChecks {
  hasSessionGrant: boolean
  hasAlwaysGrant: boolean
}

/** Whether this call must pause for the user, given the standing grants. */
export const confirmationRequired = (
  definition: Pick<ToolDefinition, "risk" | "requiresConfirmation"> | undefined,
  grants: GrantChecks
): boolean => {
  const risk = effectiveRisk(definition)
  if (risk === "low") return false
  if (risk === "critical") return true
  if (grants.hasAlwaysGrant) return false
  if (grants.hasSessionGrant) return false
  return true
}
