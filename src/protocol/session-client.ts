import { RpcMethod } from "@ollama-client/contracts/rpc"
import { extensionRpcClient } from "./extension-client"

/**
 * Hand a conversation's whole delete to the background.
 *
 * The message is posted before this first yields, which is what lets a
 * `pagehide` listener call it: the page may be gone a moment later, and the
 * background finishes the delete without it.
 */
export const requestSessionDelete = async (
  sessionId: string
): Promise<void> => {
  await extensionRpcClient.call(RpcMethod.SessionsDelete, { sessionId })
}
