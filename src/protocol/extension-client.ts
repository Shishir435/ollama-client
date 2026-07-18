import { browser } from "@/lib/browser-api"
import { createAppError, isAppError } from "@/lib/error-utils"

import type { RpcRequest, RpcResponse } from "./provider-rpc"
import {
  createRpcResponseEnvelopeSchema,
  RPC_PROTOCOL_VERSION,
  RPC_REQUEST_MESSAGE_TYPE,
  RpcErrorCode,
  type RpcMethod,
  type RpcRequestEnvelope
} from "./rpc"
import { RPC_METHOD_DEFINITIONS } from "./rpc-registry"

const timeoutError = (method: RpcMethod) =>
  createAppError(`RPC ${method} timed out`, {
    kind: "network",
    status: 408,
    messageKey: "errors.rpc.timeout",
    messageParams: { method },
    userMessage: "The background request timed out. Please try again.",
    retryable: true
  })

export const extensionRpcClient = {
  async call<M extends RpcMethod>(
    method: M,
    request: RpcRequest<M>
  ): Promise<RpcResponse<M>> {
    const requestId = crypto.randomUUID()
    const definition = RPC_METHOD_DEFINITIONS[method]
    const parsedRequest = definition.request.safeParse(request)
    if (!parsedRequest.success) {
      throw createAppError(`Invalid request for ${method}`, {
        kind: "validation",
        status: 400,
        messageKey: "errors.rpc.invalid_request",
        userMessage: "The request was invalid"
      })
    }
    const envelope: RpcRequestEnvelope<M> = {
      type: RPC_REQUEST_MESSAGE_TYPE,
      version: RPC_PROTOCOL_VERSION,
      requestId,
      method,
      request: parsedRequest.data
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const rawResponse = await Promise.race([
        browser.runtime.sendMessage(envelope),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(
            () => reject(timeoutError(method)),
            definition.timeoutMs
          )
        })
      ])
      const responseSchema = createRpcResponseEnvelopeSchema(
        definition.response
      )
      const parsedResponse = responseSchema.safeParse(rawResponse)
      if (
        !parsedResponse.success ||
        parsedResponse.data.requestId !== requestId
      ) {
        throw createAppError(`Invalid response for ${method}`, {
          kind: "validation",
          status: 502,
          messageKey: "errors.rpc.invalid_response",
          userMessage: "The background response was invalid"
        })
      }
      if (!parsedResponse.data.ok) {
        const { error } = parsedResponse.data
        throw createAppError(error.fallbackMessage, {
          kind:
            error.code === RpcErrorCode.InvalidRequest
              ? "validation"
              : "provider",
          status: error.status,
          messageKey: error.messageKey,
          messageParams: error.messageParams,
          userMessage: error.fallbackMessage,
          retryable: error.retryable,
          retryAfterMs: error.retryAfterMs,
          providerId: error.providerId,
          context: error.supportCode
        })
      }
      return parsedResponse.data.result as RpcResponse<M>
    } catch (error) {
      if (isAppError(error)) throw error
      throw createAppError(`RPC ${method} transport failed`, {
        kind: "network",
        status: 503,
        messageKey: "errors.rpc.internal",
        messageParams: { method },
        userMessage: "The background request failed. Please try again.",
        retryable: true
      })
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }
}
