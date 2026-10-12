import type {
  AgentForgetChatRowsRequest,
  AgentForgetChatRowsResult
} from "@ollama-client/contracts/agent-rpc"

import {
  applyAgentForgetChatRows,
  type StopAgentRun
} from "./agent-chat-reconcile"

let stopRun: StopAgentRun | undefined

/**
 * The run service's Stop, handed over by the Agent composition when it is
 * built and taken back when it is disposed. The RPC server is a static table
 * and the service is an instance, so this is the seam between them.
 */
export const setAgentForgetStopper = (stop: StopAgentRun | undefined): void => {
  stopRun = stop
}

/**
 * Answer a conversation's delete once the runs it names are stopped and their
 * rows settled.
 *
 * Before the composition exists there is no service, and so no run of this
 * worker that could be live: a row still marked live belongs to a previous
 * worker and is startup recovery's to settle. Stopping it is a no-op here,
 * which leaves the row where recovery will find it rather than failing the
 * delete that asked.
 */
export const forgetAgentChatRows = async (
  request: AgentForgetChatRowsRequest
): Promise<AgentForgetChatRowsResult> => {
  await applyAgentForgetChatRows(request, stopRun ?? (async () => undefined))
  return { forgotten: true }
}
