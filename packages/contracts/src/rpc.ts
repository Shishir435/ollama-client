import { z } from "zod"

/** Version shared by request, response, and cancellation envelopes. */
export const RPC_PROTOCOL_VERSION = 1 as const
export const RPC_REQUEST_MESSAGE_TYPE = "app-rpc-request" as const
export const RPC_RESPONSE_MESSAGE_TYPE = "app-rpc-response" as const
export const RPC_CANCEL_MESSAGE_TYPE = "app-rpc-cancel" as const

/** Stable RPC wire names; never duplicate these strings at call sites. */
export enum RpcMethod {
  ProvidersList = "providers.list",
  ProvidersTestConnection = "providers.testConnection",
  ProvidersListModels = "providers.listModels",
  ProvidersUpsert = "providers.upsert",
  ProvidersSetEnabled = "providers.setEnabled",
  ProvidersRemove = "providers.remove",
  ProvidersProbeModelCapabilities = "providers.probeModelCapabilities",
  ModelsGetDetails = "models.getDetails",
  ModelsListLoaded = "models.listLoaded",
  ModelsUnload = "models.unload",
  ModelsWarmup = "models.warmup",
  ModelsSearchLibrary = "models.searchLibrary",
  ModelsGetLibraryVariants = "models.getLibraryVariants",
  EmbeddingsCheckModel = "embeddings.checkModel",
  EmbeddingsPrepareModel = "embeddings.prepareModel",
  IngestionSubmit = "ingestions.submit",
  IngestionGet = "ingestions.get",
  IngestionCancel = "ingestions.cancel",
  IngestionAck = "ingestions.ack",
  ModelPullSubmit = "models.submitPull",
  ModelPullGet = "models.getPull",
  ModelPullCancel = "models.cancelPull",
  ModelPullListActive = "models.listActivePulls",
  DiagnosticsRun = "diagnostics.run",
  DiagnosticsGetBundle = "diagnostics.getBundle",
  DiagnosticsClear = "diagnostics.clear"
}

/** Safe error categories exposed by the RPC server. */
export enum RpcErrorCode {
  InvalidRequest = "invalid_request",
  Forbidden = "forbidden",
  NotFound = "not_found",
  ProviderFailed = "provider_failed",
  Timeout = "timeout",
  Internal = "internal"
}

/** Sender classifications used by runtime authorization policy. */
export type RpcSource = "extension-page" | "content-script" | "untrusted"

/** Compile-time request/result pair for one RPC method. */
export interface RpcDefinition<Request, Response> {
  request: Request
  response: Response
}

/** Credential- and stack-free failure payload safe to return to a caller. */
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

/** Versioned, method-tagged request envelope before method-level validation. */
export interface RpcRequestEnvelope<M extends RpcMethod = RpcMethod> {
  type: typeof RPC_REQUEST_MESSAGE_TYPE
  version: typeof RPC_PROTOCOL_VERSION
  requestId: string
  method: M
  request: unknown
}

/** Success or structured-failure response sharing the request correlation id. */
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

/** Strict runtime validator for the method-agnostic request envelope. */
export const RpcRequestEnvelopeSchema = z
  .object({
    type: z.literal(RPC_REQUEST_MESSAGE_TYPE),
    version: z.literal(RPC_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    method: z.enum(RpcMethod),
    request: z.unknown()
  })
  .strict()

/** Strict cancellation signal correlated by request id. */
export const RpcCancellationEnvelopeSchema = z
  .object({
    type: z.literal(RPC_CANCEL_MESSAGE_TYPE),
    version: z.literal(RPC_PROTOCOL_VERSION),
    requestId: z.string().uuid()
  })
  .strict()

/** Runtime validator for safe RPC failures. */
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

/** Build a strict response validator around a method-specific result schema. */
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
