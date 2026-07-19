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
  /**
   * The tool's definition owns a `grantScopeResolver`, so grants must bind to
   * a resolved origin. When true and `origin` is missing, the approval covers
   * only this one call — persisting a session/always grant here would create
   * the wildcard `*` grant origin scoping exists to prevent.
   */
  originScoped?: boolean
}

interface PendingConfirmation {
  resolve: (approved: boolean, scope?: ApprovalScope) => void
}

const pending = new Map<string, PendingConfirmation>()
const earlyDecisions = new Map<
  string,
  { approved: boolean; scope?: ApprovalScope }
>()

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
    let onAbort: (() => void) | undefined

    const settle = (approved: boolean, scope?: ApprovalScope) => {
      pending.delete(callId)
      if (onAbort) signal?.removeEventListener("abort", onAbort)

      // Fail closed for origin-scoped tools: no resolved origin, no standing
      // grant of any scope — the in-hand approval still covers this one call.
      const grantable = !meta.originScoped || meta.origin !== undefined

      if (approved && scope === "session" && meta.sessionId && grantable) {
        addSessionGrant(meta.sessionId, meta.toolName, meta.origin)
      }
      if (approved && scope === "always" && grantable) {
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

    if (signal?.aborted) {
      settle(false)
      return
    }

    // A user can click while the sidepanel is reconnecting to a restarted
    // worker, before the restored loop has re-registered this waiter.
    const early = earlyDecisions.get(callId)
    if (early) {
      earlyDecisions.delete(callId)
      settle(early.approved, early.scope)
      return
    }

    onAbort = () => settle(false)
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
  const entry = pending.get(callId)
  if (entry) {
    entry.resolve(approved, scope)
    return
  }

  // Short reconnect race buffer. Bounded because model-provided ids are
  // untrusted and runtime messages can arrive without a matching stream.
  if (earlyDecisions.size >= 100) {
    const oldest = earlyDecisions.keys().next().value
    if (oldest) earlyDecisions.delete(oldest)
  }
  earlyDecisions.set(callId, { approved, scope })
}

/** Deny every outstanding confirmation (e.g. on a hard reset). */
export const clearPendingConfirmations = (): void => {
  for (const entry of pending.values()) entry.resolve(false)
  pending.clear()
  earlyDecisions.clear()
}
