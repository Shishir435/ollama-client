import {
  EmbeddingsNativeGenerateRequestSchema,
  EmbeddingsNativeGenerateResultSchema
} from "@ollama-client/contracts/model-rpc"
import {
  RPC_PROTOCOL_VERSION,
  RPC_RESPONSE_MESSAGE_TYPE,
  RpcCancellationEnvelopeSchema,
  RpcErrorCode,
  RpcMethod,
  RpcRequestEnvelopeSchema
} from "@ollama-client/contracts/rpc"
import { isTrustedPersistenceSender } from "@/lib/persistence/host-authorization"
import { generateInNativeWorker } from "./worker-client"

/** The sole offscreen RPC method. Content scripts cannot invoke inference. */
export const registerNativeEmbeddingHost = () => {
  const active = new Map<string, AbortController>()
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      !isTrustedPersistenceSender(
        sender,
        chrome.runtime.id,
        chrome.runtime.getURL("")
      )
    )
      return false
    const cancel = RpcCancellationEnvelopeSchema.safeParse(message)
    if (cancel.success) {
      active.get(cancel.data.requestId)?.abort()
      return false
    }
    const envelope = RpcRequestEnvelopeSchema.safeParse(message)
    if (
      !envelope.success ||
      envelope.data.method !== RpcMethod.EmbeddingsNativeGenerate
    )
      return false
    const { requestId, request } = envelope.data
    const parsed = EmbeddingsNativeGenerateRequestSchema.safeParse(request)
    const base = {
      type: RPC_RESPONSE_MESSAGE_TYPE,
      version: RPC_PROTOCOL_VERSION,
      requestId
    }
    if (!parsed.success || active.has(requestId)) {
      respond({
        ...base,
        ok: false,
        error: {
          code: RpcErrorCode.InvalidRequest,
          status: 400,
          fallbackMessage: "Invalid embedding request",
          messageKey: "errors.rpc.invalid_request",
          supportCode: requestId
        }
      })
      return false
    }
    const controller = new AbortController()
    active.set(requestId, controller)
    void generateInNativeWorker(parsed.data.text, controller.signal)
      .then((embedding) => {
        respond({
          ...base,
          ok: true,
          result: EmbeddingsNativeGenerateResultSchema.parse({ embedding })
        })
      })
      .catch(() => {
        respond({
          ...base,
          ok: false,
          error: {
            code: RpcErrorCode.Internal,
            status: 503,
            fallbackMessage:
              "Bundled embeddings could not start. Please retry.",
            messageKey: "errors.rpc.internal",
            retryable: true,
            supportCode: requestId
          }
        })
      })
      .finally(() => active.delete(requestId))
    return true
  })
}
