/**
 * Pending tool-confirmation registry (background).
 *
 * A confirmation-gated tool call pauses the loop and registers a pending
 * decision keyed by the tool-call id. The UI posts a CONFIRM_TOOL runtime
 * message (routed in the message router) which resolves it, optionally with a
 * grant scope ("session" = rest of this chat, "always" = persisted per tool ×
 * origin). Aborting the stream resolves it as a denial so a hung confirmation
 * can't wedge the loop. Same single-context Map pattern as the
 * abort-controller registry.
 */
import { logger } from "@/lib/logger"
import { addAlwaysGrant } from "@/lib/tools/approval/approval-grants"
import type { ApprovalScope } from "@/lib/tools/approval/approval-policy"
import { addSessionGrant } from "./tool-session-grants"

/** What the decision covers — used to apply session/always grants on approval. */
export interface ConfirmationMeta {
  toolName: string
  sessionId?: string
  origin?: string
}

interface PendingConfirmation {
  resolve: (approved: boolean, scope?: ApprovalScope) => void
}

const pending = new Map<string, PendingConfirmation>()

/**
 * Wait for the user's decision on a tool call. Resolves `true` on approval,
 * `false` on denial or if the signal aborts first. An approval's scope is
 * applied here (session grant / persisted always-grant) so every caller gets
 * identical grant semantics. Safe to await once per id.
 */
export const awaitToolConfirmation = (
  callId: string,
  meta: ConfirmationMeta,
  signal?: AbortSignal
): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }

    const settle = (approved: boolean, scope?: ApprovalScope) => {
      pending.delete(callId)
      if (onAbort) signal?.removeEventListener("abort", onAbort)

      if (approved && scope === "session" && meta.sessionId) {
        addSessionGrant(meta.sessionId, meta.toolName, meta.origin)
      }
      if (approved && scope === "always") {
        // Fire-and-forget: the grant covers future calls; this one proceeds on
        // the in-hand approval either way.
        addAlwaysGrant(meta.toolName, meta.origin).catch((error) => {
          logger.warn("Failed to persist always-allow grant", "ToolApproval", {
            tool: meta.toolName,
            error
          })
        })
      }

      resolve(approved)
    }

    const onAbort = () => settle(false)
    signal?.addEventListener("abort", onAbort, { once: true })

    // Last write wins if the same id somehow re-registers.
    pending.set(callId, { resolve: settle })
  })

/** Resolve a pending confirmation (from the UI's CONFIRM_TOOL message). */
export const resolveToolConfirmation = (
  callId: string,
  approved: boolean,
  scope?: ApprovalScope
): void => {
  pending.get(callId)?.resolve(approved, scope)
}

/** Deny every outstanding confirmation (e.g. on a hard reset). */
export const clearPendingConfirmations = (): void => {
  for (const entry of pending.values()) entry.resolve(false)
  pending.clear()
}
