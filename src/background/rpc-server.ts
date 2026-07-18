import type { Runtime } from "webextension-polyfill"

import { classifyRuntimeSender } from "@/background/runtime-sender-authorization"
import { isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { ProviderRpcService } from "@/lib/providers/provider-rpc-service"
import type { RpcMap, RpcRequest, RpcResponse } from "@/protocol/provider-rpc"
import {
  RPC_PROTOCOL_VERSION,
  RPC_RESPONSE_MESSAGE_TYPE,
  RpcCancellationEnvelopeSchema,
  RpcErrorCode,
  type RpcErrorPayload,
  RpcMethod,
  RpcRequestEnvelopeSchema,
  type RpcResponseEnvelope
} from "@/protocol/rpc"
import { RPC_METHOD_DEFINITIONS } from "@/protocol/rpc-registry"

type RpcHandlers = {
  [M in RpcMethod]: (
    request: RpcRequest<M>,
    signal: AbortSignal
  ) => Promise<RpcResponse<M>>
}

const handlers = {
  [RpcMethod.ProvidersList]: async () => ProviderRpcService.list(),
  [RpcMethod.ProvidersTestConnection]: async (request, signal) =>
    ProviderRpcService.testConnection(request, signal),
  [RpcMethod.ProvidersListModels]: async (request, signal) =>
    ProviderRpcService.listModels(request, signal),
  [RpcMethod.ProvidersUpsert]: async (request) =>
    ProviderRpcService.upsert(request),
  [RpcMethod.ProvidersRemove]: async (request) =>
    ProviderRpcService.remove(request),
  [RpcMethod.ProvidersProbeModelCapabilities]: async (request, signal) =>
    ProviderRpcService.probeModelCapabilities(request, signal)
} satisfies RpcHandlers

const activeRequests = new Map<string, AbortController>()

const supportCode = (code: RpcErrorCode, requestId: string): string =>
  `RPC-${code.replaceAll("_", "-").toUpperCase()}-${requestId.slice(0, 8).toUpperCase()}`

const rpcError = (
  code: RpcErrorCode,
  requestId: string,
  options: Partial<RpcErrorPayload> = {}
): RpcErrorPayload => ({
  code,
  status: options.status ?? 500,
  fallbackMessage: options.fallbackMessage ?? "The background request failed",
  supportCode: supportCode(code, requestId),
  ...(options.messageKey && { messageKey: options.messageKey }),
  ...(options.messageParams && { messageParams: options.messageParams }),
  ...(options.retryable !== undefined && { retryable: options.retryable }),
  ...(options.retryAfterMs !== undefined && {
    retryAfterMs: options.retryAfterMs
  }),
  ...(options.providerId && { providerId: options.providerId })
})

const normalizeRpcError = (
  error: unknown,
  requestId: string
): RpcErrorPayload => {
  if (!isAppError(error)) {
    return rpcError(RpcErrorCode.Internal, requestId, {
      status: 500,
      fallbackMessage: "The background request failed",
      messageKey: "errors.rpc.internal"
    })
  }
  const code =
    error.kind === "validation"
      ? RpcErrorCode.InvalidRequest
      : error.status === 404
        ? RpcErrorCode.NotFound
        : RpcErrorCode.ProviderFailed
  return rpcError(code, requestId, {
    status: error.status ?? (code === RpcErrorCode.InvalidRequest ? 400 : 500),
    fallbackMessage:
      error.userMessage ??
      (code === RpcErrorCode.NotFound
        ? "Provider configuration was not found"
        : "The provider request failed"),
    messageKey: error.messageKey ?? `errors.rpc.${code}`,
    messageParams: error.messageParams,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
    providerId: error.providerId
  })
}

const response = <T>(
  requestId: string,
  value: { ok: true; result: T } | { ok: false; error: RpcErrorPayload }
): RpcResponseEnvelope<T> => ({
  type: RPC_RESPONSE_MESSAGE_TYPE,
  version: RPC_PROTOCOL_VERSION,
  requestId,
  ...value
})

export const handleRpcCancellation = (
  rawMessage: unknown,
  sender: Runtime.MessageSender,
  extensionId: string,
  extensionUrlPrefix: string,
  sendResponse: (value: unknown) => void
): void => {
  const parsed = RpcCancellationEnvelopeSchema.safeParse(rawMessage)
  const source = classifyRuntimeSender(sender, extensionId, extensionUrlPrefix)
  if (!parsed.success || source !== "extension-page") {
    sendResponse({ success: false })
    return
  }

  const controller = activeRequests.get(parsed.data.requestId)
  controller?.abort()
  sendResponse({ success: true, cancelled: Boolean(controller) })
}

export const handleRpcRequest = async (
  rawMessage: unknown,
  sender: Runtime.MessageSender,
  extensionId: string,
  extensionUrlPrefix: string,
  sendResponse: (value: unknown) => void
): Promise<void> => {
  const startedAt = performance.now()
  const parsedEnvelope = RpcRequestEnvelopeSchema.safeParse(rawMessage)
  const unsafeRequestId =
    rawMessage &&
    typeof rawMessage === "object" &&
    "requestId" in rawMessage &&
    typeof rawMessage.requestId === "string" &&
    RpcRequestEnvelopeSchema.shape.requestId.safeParse(rawMessage.requestId)
      .success
      ? rawMessage.requestId
      : crypto.randomUUID()
  if (!parsedEnvelope.success) {
    sendResponse(
      response(unsafeRequestId, {
        ok: false,
        error: rpcError(RpcErrorCode.InvalidRequest, unsafeRequestId, {
          status: 400,
          fallbackMessage: "The RPC envelope was invalid",
          messageKey: "errors.rpc.invalid_request"
        })
      })
    )
    return
  }

  const { requestId, method, request } = parsedEnvelope.data
  const definition = RPC_METHOD_DEFINITIONS[method]
  const source = classifyRuntimeSender(sender, extensionId, extensionUrlPrefix)
  if (!definition.allowedSources.includes(source as "extension-page")) {
    sendResponse(
      response(requestId, {
        ok: false,
        error: rpcError(RpcErrorCode.Forbidden, requestId, {
          status: 403,
          fallbackMessage: "This RPC method is not allowed from this context",
          messageKey: "errors.rpc.forbidden"
        })
      })
    )
    return
  }

  const parsedRequest = definition.request.safeParse(request)
  if (!parsedRequest.success) {
    sendResponse(
      response(requestId, {
        ok: false,
        error: rpcError(RpcErrorCode.InvalidRequest, requestId, {
          status: 400,
          fallbackMessage: "The RPC request payload was invalid",
          messageKey: "errors.rpc.invalid_request"
        })
      })
    )
    return
  }

  if (activeRequests.has(requestId)) {
    sendResponse(
      response(requestId, {
        ok: false,
        error: rpcError(RpcErrorCode.InvalidRequest, requestId, {
          status: 409,
          fallbackMessage: "The RPC request id is already active",
          messageKey: "errors.rpc.invalid_request"
        })
      })
    )
    return
  }

  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  const serverTimeoutId = setTimeout(
    () => controller.abort(),
    definition.timeoutMs
  )

  let status = "success"
  let errorCode: RpcErrorCode | undefined
  try {
    const handler = handlers[method] as (
      value: unknown,
      signal: AbortSignal
    ) => Promise<RpcMap[RpcMethod]["response"]>
    const result = await handler(parsedRequest.data, controller.signal)
    const parsedResult = definition.response.safeParse(result)
    if (!parsedResult.success) {
      throw new Error(`RPC handler returned invalid data for ${method}`)
    }
    sendResponse(response(requestId, { ok: true, result: parsedResult.data }))
  } catch (error) {
    const cancelled = controller.signal.aborted
    status = cancelled ? "cancelled" : "error"
    const normalized = cancelled
      ? rpcError(RpcErrorCode.Timeout, requestId, {
          status: 408,
          fallbackMessage: "The background request timed out",
          messageKey: "errors.rpc.timeout",
          retryable: true
        })
      : normalizeRpcError(error, requestId)
    errorCode = normalized.code
    sendResponse(response(requestId, { ok: false, error: normalized }))
    if (!cancelled) {
      logger.error("RPC request failed", "RpcServer", {
        requestId,
        method,
        code: normalized.code,
        supportCode: normalized.supportCode
      })
    }
  } finally {
    clearTimeout(serverTimeoutId)
    if (activeRequests.get(requestId) === controller) {
      activeRequests.delete(requestId)
    }
    logger.info("RPC request completed", "RpcServer", {
      requestId,
      method,
      source,
      status,
      errorCode,
      durationMs: Math.max(0, performance.now() - startedAt)
    })
  }
}
