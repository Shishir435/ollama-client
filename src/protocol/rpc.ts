import { z } from "zod"

export const RPC_PROTOCOL_VERSION = 1 as const
export const RPC_REQUEST_MESSAGE_TYPE = "app-rpc-request" as const
export const RPC_RESPONSE_MESSAGE_TYPE = "app-rpc-response" as const
export const RPC_CANCEL_MESSAGE_TYPE = "app-rpc-cancel" as const

export enum RpcMethod {
  ProvidersList = "providers.list",
  ProvidersTestConnection = "providers.testConnection",
  ProvidersListModels = "providers.listModels",
  ProvidersUpsert = "providers.upsert",
  ProvidersRemove = "providers.remove",
  ProvidersProbeModelCapabilities = "providers.probeModelCapabilities",
  DiagnosticsRun = "diagnostics.run",
  DiagnosticsGetBundle = "diagnostics.getBundle",
  DiagnosticsClear = "diagnostics.clear"
}

export enum RpcErrorCode {
  InvalidRequest = "invalid_request",
  Forbidden = "forbidden",
  NotFound = "not_found",
  ProviderFailed = "provider_failed",
  Timeout = "timeout",
  Internal = "internal"
}

export type RpcSource = "extension-page" | "content-script" | "untrusted"

export interface RpcDefinition<Request, Response> {
  request: Request
  response: Response
}

export interface RpcErrorPayload {
  code: RpcErrorCode
  status: number
  fallbackMessage: string
  messageKey?: string
  messageParams?: Record<string, string | number | boolean>
  retryable?: boolean
  retryAfterMs?: number
  providerId?: string
  supportCode: string
}

export interface RpcRequestEnvelope<M extends RpcMethod = RpcMethod> {
  type: typeof RPC_REQUEST_MESSAGE_TYPE
  version: typeof RPC_PROTOCOL_VERSION
  requestId: string
  method: M
  request: unknown
}

export type RpcResponseEnvelope<Response = unknown> =
  | {
      type: typeof RPC_RESPONSE_MESSAGE_TYPE
      version: typeof RPC_PROTOCOL_VERSION
      requestId: string
      ok: true
      result: Response
    }
  | {
      type: typeof RPC_RESPONSE_MESSAGE_TYPE
      version: typeof RPC_PROTOCOL_VERSION
      requestId: string
      ok: false
      error: RpcErrorPayload
    }

export const RpcRequestEnvelopeSchema = z
  .object({
    type: z.literal(RPC_REQUEST_MESSAGE_TYPE),
    version: z.literal(RPC_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    method: z.enum(RpcMethod),
    request: z.unknown()
  })
  .strict()

export const RpcCancellationEnvelopeSchema = z
  .object({
    type: z.literal(RPC_CANCEL_MESSAGE_TYPE),
    version: z.literal(RPC_PROTOCOL_VERSION),
    requestId: z.string().uuid()
  })
  .strict()

export const RpcErrorPayloadSchema = z
  .object({
    code: z.enum(RpcErrorCode),
    status: z.number().int(),
    fallbackMessage: z.string(),
    messageKey: z.string().optional(),
    messageParams: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    retryable: z.boolean().optional(),
    retryAfterMs: z.number().nonnegative().optional(),
    providerId: z.string().optional(),
    supportCode: z.string()
  })
  .strict()

export const createRpcResponseEnvelopeSchema = <T extends z.ZodType>(
  result: T
) =>
  z.discriminatedUnion("ok", [
    z
      .object({
        type: z.literal(RPC_RESPONSE_MESSAGE_TYPE),
        version: z.literal(RPC_PROTOCOL_VERSION),
        requestId: z.string().uuid(),
        ok: z.literal(true),
        result
      })
      .strict(),
    z
      .object({
        type: z.literal(RPC_RESPONSE_MESSAGE_TYPE),
        version: z.literal(RPC_PROTOCOL_VERSION),
        requestId: z.string().uuid(),
        ok: z.literal(false),
        error: RpcErrorPayloadSchema
      })
      .strict()
  ])
