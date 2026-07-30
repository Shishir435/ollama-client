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
  IngestionAckRequestSchema,
  IngestionAckResultSchema,
  IngestionCancelRequestSchema,
  IngestionCancelResultSchema,
  IngestionGetRequestSchema,
  IngestionGetResultSchema,
  IngestionSubmitRequestSchema,
  IngestionSubmitResultSchema
} from "./ingestion-rpc"
import {
  ModelPullCancelRequestSchema,
  ModelPullCancelResultSchema,
  ModelPullGetRequestSchema,
  ModelPullGetResultSchema,
  ModelPullListActiveRequestSchema,
  ModelPullListActiveResultSchema,
  ModelPullSubmitRequestSchema,
  ModelPullSubmitResultSchema
} from "./model-pull-rpc"

import {
  EmbeddingsCheckModelRequestSchema,
  EmbeddingsCheckModelResultSchema,
  EmbeddingsPrepareModelRequestSchema,
  EmbeddingsPrepareModelResultSchema,
  ModelsGetDetailsRequestSchema,
  ModelsGetDetailsResultSchema,
  ModelsGetLibraryVariantsRequestSchema,
  ModelsGetLibraryVariantsResultSchema,
  ModelsListLoadedRequestSchema,
  ModelsListLoadedResultSchema,
  ModelsSearchLibraryRequestSchema,
  ModelsSearchLibraryResultSchema,
  ModelsUnloadRequestSchema,
  ModelsUnloadResultSchema,
  ModelsWarmupRequestSchema,
  ModelsWarmupResultSchema
} from "./model-rpc"

import {
  ProvidersListModelsRequestSchema,
  ProvidersListModelsResultSchema,
  ProvidersListRequestSchema,
  ProvidersListResultSchema,
  ProvidersProbeModelCapabilitiesRequestSchema,
  ProvidersProbeModelCapabilitiesResultSchema,
  ProvidersRemoveRequestSchema,
  ProvidersRemoveResultSchema,
  ProvidersSetEnabledRequestSchema,
  ProvidersSetEnabledResultSchema,
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
  [RpcMethod.ProvidersSetEnabled]: {
    request: ProvidersSetEnabledRequestSchema,
    response: ProvidersSetEnabledResultSchema,
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
  [RpcMethod.ModelsGetDetails]: {
    request: ModelsGetDetailsRequestSchema,
    response: ModelsGetDetailsResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 15_000,
    operation: "query"
  },
  [RpcMethod.ModelsListLoaded]: {
    request: ModelsListLoadedRequestSchema,
    response: ModelsListLoadedResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 15_000,
    operation: "query"
  },
  [RpcMethod.ModelsUnload]: {
    request: ModelsUnloadRequestSchema,
    response: ModelsUnloadResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 30_000,
    operation: "command"
  },
  [RpcMethod.ModelsWarmup]: {
    request: ModelsWarmupRequestSchema,
    response: ModelsWarmupResultSchema,
    allowedSources: extensionPagesOnly,
    // A cold model can take a while to become resident; this is the same wait
    // the user would see on their first message.
    timeoutMs: 120_000,
    operation: "command"
  },
  [RpcMethod.ModelsSearchLibrary]: {
    request: ModelsSearchLibraryRequestSchema,
    response: ModelsSearchLibraryResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 20_000,
    operation: "query"
  },
  [RpcMethod.ModelsGetLibraryVariants]: {
    request: ModelsGetLibraryVariantsRequestSchema,
    response: ModelsGetLibraryVariantsResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 20_000,
    operation: "query"
  },
  [RpcMethod.EmbeddingsCheckModel]: {
    request: EmbeddingsCheckModelRequestSchema,
    response: EmbeddingsCheckModelResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 15_000,
    operation: "query"
  },
  [RpcMethod.EmbeddingsPrepareModel]: {
    request: EmbeddingsPrepareModelRequestSchema,
    response: EmbeddingsPrepareModelResultSchema,
    allowedSources: extensionPagesOnly,
    // Preparing can mean pulling the model.
    timeoutMs: 300_000,
    operation: "command"
  },
  [RpcMethod.IngestionSubmit]: {
    request: IngestionSubmitRequestSchema,
    response: IngestionSubmitResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 15_000,
    operation: "command"
  },
  [RpcMethod.IngestionGet]: {
    request: IngestionGetRequestSchema,
    response: IngestionGetResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 5_000,
    operation: "query"
  },
  [RpcMethod.IngestionCancel]: {
    request: IngestionCancelRequestSchema,
    response: IngestionCancelResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 10_000,
    operation: "command"
  },
  [RpcMethod.IngestionAck]: {
    request: IngestionAckRequestSchema,
    response: IngestionAckResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 5_000,
    operation: "command"
  },
  [RpcMethod.ModelPullSubmit]: {
    request: ModelPullSubmitRequestSchema,
    response: ModelPullSubmitResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 15_000,
    operation: "command"
  },
  [RpcMethod.ModelPullGet]: {
    request: ModelPullGetRequestSchema,
    response: ModelPullGetResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 5_000,
    operation: "query"
  },
  [RpcMethod.ModelPullCancel]: {
    request: ModelPullCancelRequestSchema,
    response: ModelPullCancelResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 10_000,
    operation: "command"
  },
  [RpcMethod.ModelPullListActive]: {
    request: ModelPullListActiveRequestSchema,
    response: ModelPullListActiveResultSchema,
    allowedSources: extensionPagesOnly,
    timeoutMs: 5_000,
    operation: "query"
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
