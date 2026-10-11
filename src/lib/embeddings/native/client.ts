import { RpcMethod } from "@ollama-client/contracts/rpc"
import { ensurePersistenceHost } from "@/lib/persistence/client"
import { extensionRpcClient } from "@/protocol/extension-client"
import { generateInNativeWorker } from "./worker-client"

/** The existing offscreen document owns Chromium inference; Firefox uses its background page. */
export const generateBundledEmbedding = async (
  text: string,
  signal?: AbortSignal
): Promise<number[]> => {
  signal?.throwIfAborted()
  await ensurePersistenceHost()
  signal?.throwIfAborted()
  if (__FIREFOX_BG_OWNER__ && globalThis.__persistenceHostCall) {
    return generateInNativeWorker(text, signal)
  }
  const result = await extensionRpcClient.call(
    RpcMethod.EmbeddingsNativeGenerate,
    { text },
    { signal }
  )
  return result.embedding
}
