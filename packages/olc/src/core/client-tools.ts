/**
 * The `callClientTool` port every backend receives.
 *
 * Why it is separate from the chat route: a backend is constructed before its routes
 * are registered — it may register routes of its own — and it needs this port from
 * the moment it exists. Parking a call has no dependency on the HTTP layer, only on
 * the registry that correlates it with the client's next request.
 */
import type { ClientToolInvocation } from "../backends/types.js"
import type { PendingToolCalls } from "./pending-tool-calls.js"

export const createClientToolInvoker =
  ({ pending }: { pending: PendingToolCalls }) =>
  async ({
    turnId,
    tool,
    args,
    signal
  }: ClientToolInvocation): Promise<string> => {
    const { callId, promise } = pending.register({ turnId, tool, args })
    signal?.addEventListener("abort", () => {
      pending.fail(callId, "The backend cancelled the tool call")
    })
    return await promise
  }
