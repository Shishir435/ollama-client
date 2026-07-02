/**
 * Pending tool-confirmation registry (background).
 *
 * A destructive tool call pauses the loop and registers a pending decision keyed
 * by the tool-call id. The UI posts a CONFIRM_TOOL runtime message (routed in
 * the message router) which resolves it. Aborting the stream resolves it as a
 * denial so a hung confirmation can't wedge the loop. Same single-context Map
 * pattern as the abort-controller registry.
 */
interface PendingConfirmation {
  resolve: (approved: boolean) => void
}

const pending = new Map<string, PendingConfirmation>()

/**
 * Wait for the user's decision on a tool call. Resolves `true` on approval,
 * `false` on denial or if the signal aborts first. Safe to await once per id.
 */
export const awaitToolConfirmation = (
  callId: string,
  signal?: AbortSignal
): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }

    const settle = (approved: boolean) => {
      pending.delete(callId)
      if (onAbort) signal?.removeEventListener("abort", onAbort)
      resolve(approved)
    }

    const onAbort = () => settle(false)
    signal?.addEventListener("abort", onAbort, { once: true })

    // Last write wins if the same id somehow re-registers.
    pending.set(callId, { resolve: (approved) => settle(approved) })
  })

/** Resolve a pending confirmation (from the UI's CONFIRM_TOOL message). */
export const resolveToolConfirmation = (
  callId: string,
  approved: boolean
): void => {
  pending.get(callId)?.resolve(approved)
}

/** Deny every outstanding confirmation (e.g. on a hard reset). */
export const clearPendingConfirmations = (): void => {
  for (const entry of pending.values()) entry.resolve(false)
  pending.clear()
}
