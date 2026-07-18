import type { z } from "zod"

import {
  ProvidersListModelsRequestSchema,
  ProvidersListModelsResultSchema,
  ProvidersListRequestSchema,
  ProvidersListResultSchema,
  ProviderTestConnectionRequestSchema,
  ProviderTestConnectionResultSchema
} from "./provider-rpc"
import { RpcMethod, type RpcSource } from "./rpc"

export interface RpcMethodDefinition {
  request: z.ZodType
  response: z.ZodType
  allowedSources: readonly RpcSource[]
  timeoutMs: number
  operation: "query" | "command"
}

const extensionPagesOnly = ["extension-page"] as const

export const RPC_METHOD_DEFINITIONS = {
  [RpcMethod.ProvidersList]: {
    request: ProvidersListRequestSchema,
    response: ProvidersListResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 5_000,
    operation: "query"
  },
  [RpcMethod.ProvidersTestConnection]: {
    request: ProviderTestConnectionRequestSchema,
    response: ProviderTestConnectionResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 30_000,
    operation: "command"
  },
  [RpcMethod.ProvidersListModels]: {
    request: ProvidersListModelsRequestSchema,
    response: ProvidersListModelsResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 30_000,
    operation: "query"
  }
} as const satisfies Record<RpcMethod, RpcMethodDefinition>
