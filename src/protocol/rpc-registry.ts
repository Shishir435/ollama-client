import type { z } from "zod"

import {
  DiagnosticsClearRequestSchema,
  DiagnosticsClearResultSchema,
  DiagnosticsGetBundleRequestSchema,
  DiagnosticsGetBundleResultSchema,
  DiagnosticsRunRequestSchema,
  DiagnosticsRunResultSchema
} from "./diagnostics-rpc"

import {
  ProvidersListModelsRequestSchema,
  ProvidersListModelsResultSchema,
  ProvidersListRequestSchema,
  ProvidersListResultSchema,
  ProvidersProbeModelCapabilitiesRequestSchema,
  ProvidersProbeModelCapabilitiesResultSchema,
  ProvidersRemoveRequestSchema,
  ProvidersRemoveResultSchema,
  ProvidersUpsertRequestSchema,
  ProvidersUpsertResultSchema,
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
  },
  [RpcMethod.ProvidersUpsert]: {
    request: ProvidersUpsertRequestSchema,
    response: ProvidersUpsertResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 10_000,
    operation: "command"
  },
  [RpcMethod.ProvidersRemove]: {
    request: ProvidersRemoveRequestSchema,
    response: ProvidersRemoveResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 10_000,
    operation: "command"
  },
  [RpcMethod.ProvidersProbeModelCapabilities]: {
    request: ProvidersProbeModelCapabilitiesRequestSchema,
    response: ProvidersProbeModelCapabilitiesResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 35_000,
    operation: "command"
  },
  [RpcMethod.DiagnosticsRun]: {
    request: DiagnosticsRunRequestSchema,
    response: DiagnosticsRunResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 30_000,
    operation: "command"
  },
  [RpcMethod.DiagnosticsGetBundle]: {
    request: DiagnosticsGetBundleRequestSchema,
    response: DiagnosticsGetBundleResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 30_000,
    operation: "query"
  },
  [RpcMethod.DiagnosticsClear]: {
    request: DiagnosticsClearRequestSchema,
    response: DiagnosticsClearResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 5_000,
    operation: "command"
  }
} as const satisfies Record<RpcMethod, RpcMethodDefinition>
