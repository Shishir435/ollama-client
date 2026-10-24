import type {
  AgentForgetChatRowsRequest,
  AgentForgetChatRowsResult,
  AgentGetReadinessRequest,
  AgentGetReadinessResult,
  AgentGetRunRequest,
  AgentGetRunResult
} from "@ollama-client/contracts/agent-rpc"
import type {
  DiagnosticsClearRequest,
  DiagnosticsClearResult,
  DiagnosticsGetBundleRequest,
  DiagnosticsGetBundleResult,
  DiagnosticsRunRequest,
  DiagnosticsRunResult
} from "@ollama-client/contracts/diagnostics-rpc"
import type {
  IngestionAckRequest,
  IngestionAckResult,
  IngestionCancelRequest,
  IngestionCancelResult,
  IngestionGetRequest,
  IngestionGetResult,
  IngestionSubmitRequest,
  IngestionSubmitResult
} from "@ollama-client/contracts/ingestion-rpc"
import type {
  ModelPullCancelRequest,
  ModelPullCancelResult,
  ModelPullGetRequest,
  ModelPullGetResult,
  ModelPullListActiveRequest,
  ModelPullListActiveResult,
  ModelPullSubmitRequest,
  ModelPullSubmitResult
} from "@ollama-client/contracts/model-pull-rpc"
import type {
  EmbeddingsCheckModelRequest,
  EmbeddingsCheckModelResult,
  EmbeddingsGenerateRequest,
  EmbeddingsGenerateResult,
  EmbeddingsNativeCommandRequestSchema,
  EmbeddingsNativeCommandResultSchema,
  EmbeddingsNativeGenerateRequestSchema,
  EmbeddingsNativeGenerateResultSchema,
  EmbeddingsNativeStatusRequestSchema,
  EmbeddingsNativeStatusResultSchema,
  EmbeddingsPrepareModelRequest,
  EmbeddingsPrepareModelResult,
  ModelsGetDetailsRequest,
  ModelsGetDetailsResult,
  ModelsGetLibraryVariantsRequest,
  ModelsGetLibraryVariantsResult,
  ModelsListLoadedRequest,
  ModelsListLoadedResult,
  ModelsSearchLibraryRequest,
  ModelsSearchLibraryResult,
  ModelsUnloadRequest,
  ModelsUnloadResult,
  ModelsWarmupRequest,
  ModelsWarmupResult
} from "@ollama-client/contracts/model-rpc"
import {
  BrowserModelStatusRequestSchema,
  BrowserModelStatusResultSchema
} from "@ollama-client/contracts/provider-rpc"
import type {
  ProvidersIconsRequest,
  ProvidersIconsResult,
  ProvidersListModelsRequest,
  ProvidersListModelsResult,
  ProvidersListRequest,
  ProvidersListResult,
  ProvidersProbeModelCapabilitiesRequest,
  ProvidersProbeModelCapabilitiesResult,
  ProvidersRemoveRequest,
  ProvidersRemoveResult,
  ProvidersSetEnabledRequest,
  ProvidersSetEnabledResult,
  ProvidersUpsertRequest,
  ProvidersUpsertResult,
  ProviderTestConnectionRequest,
  ProviderTestConnectionResult
} from "@ollama-client/contracts/provider-rpc"
import { type RpcDefinition, RpcMethod } from "@ollama-client/contracts/rpc"
import type { z } from "zod"

/** Application-wide composition of package-owned RPC method contracts. */
export interface RpcMap {
  [RpcMethod.EmbeddingsIndexMessages]: RpcDefinition<
    import("@ollama-client/contracts/model-rpc").EmbeddingsIndexMessagesRequest,
    import("@ollama-client/contracts/model-rpc").EmbeddingsIndexMessagesResult
  >
  [RpcMethod.BrowserModelStatus]: RpcDefinition<
    z.input<typeof BrowserModelStatusRequestSchema>,
    z.infer<typeof BrowserModelStatusResultSchema>
  >
  [RpcMethod.EmbeddingsNativeGenerate]: RpcDefinition<
    z.input<typeof EmbeddingsNativeGenerateRequestSchema>,
    z.infer<typeof EmbeddingsNativeGenerateResultSchema>
  >
  [RpcMethod.EmbeddingsNativeStatus]: RpcDefinition<
    z.input<typeof EmbeddingsNativeStatusRequestSchema>,
    z.infer<typeof EmbeddingsNativeStatusResultSchema>
  >
  [RpcMethod.EmbeddingsNativeCommand]: RpcDefinition<
    z.input<typeof EmbeddingsNativeCommandRequestSchema>,
    z.infer<typeof EmbeddingsNativeCommandResultSchema>
  >

  [RpcMethod.ProvidersList]: RpcDefinition<
    ProvidersListRequest,
    ProvidersListResult
  >
  [RpcMethod.ProvidersTestConnection]: RpcDefinition<
    ProviderTestConnectionRequest,
    ProviderTestConnectionResult
  >
  [RpcMethod.ProvidersListModels]: RpcDefinition<
    ProvidersListModelsRequest,
    ProvidersListModelsResult
  >
  [RpcMethod.ProvidersUpsert]: RpcDefinition<
    ProvidersUpsertRequest,
    ProvidersUpsertResult
  >
  [RpcMethod.ProvidersSetEnabled]: RpcDefinition<
    ProvidersSetEnabledRequest,
    ProvidersSetEnabledResult
  >
  [RpcMethod.ProvidersRemove]: RpcDefinition<
    ProvidersRemoveRequest,
    ProvidersRemoveResult
  >
  [RpcMethod.ProvidersProbeModelCapabilities]: RpcDefinition<
    ProvidersProbeModelCapabilitiesRequest,
    ProvidersProbeModelCapabilitiesResult
  >
  [RpcMethod.ProvidersIcons]: RpcDefinition<
    ProvidersIconsRequest,
    ProvidersIconsResult
  >
  [RpcMethod.ModelsGetDetails]: RpcDefinition<
    ModelsGetDetailsRequest,
    ModelsGetDetailsResult
  >
  [RpcMethod.ModelsListLoaded]: RpcDefinition<
    ModelsListLoadedRequest,
    ModelsListLoadedResult
  >
  [RpcMethod.ModelsUnload]: RpcDefinition<
    ModelsUnloadRequest,
    ModelsUnloadResult
  >
  [RpcMethod.ModelsWarmup]: RpcDefinition<
    ModelsWarmupRequest,
    ModelsWarmupResult
  >
  [RpcMethod.ModelsSearchLibrary]: RpcDefinition<
    ModelsSearchLibraryRequest,
    ModelsSearchLibraryResult
  >
  [RpcMethod.ModelsGetLibraryVariants]: RpcDefinition<
    ModelsGetLibraryVariantsRequest,
    ModelsGetLibraryVariantsResult
  >
  [RpcMethod.EmbeddingsCheckModel]: RpcDefinition<
    EmbeddingsCheckModelRequest,
    EmbeddingsCheckModelResult
  >
  [RpcMethod.EmbeddingsPrepareModel]: RpcDefinition<
    EmbeddingsPrepareModelRequest,
    EmbeddingsPrepareModelResult
  >
  [RpcMethod.EmbeddingsGenerate]: RpcDefinition<
    EmbeddingsGenerateRequest,
    EmbeddingsGenerateResult
  >
  [RpcMethod.IngestionSubmit]: RpcDefinition<
    IngestionSubmitRequest,
    IngestionSubmitResult
  >
  [RpcMethod.IngestionGet]: RpcDefinition<
    IngestionGetRequest,
    IngestionGetResult
  >
  [RpcMethod.IngestionCancel]: RpcDefinition<
    IngestionCancelRequest,
    IngestionCancelResult
  >
  [RpcMethod.IngestionAck]: RpcDefinition<
    IngestionAckRequest,
    IngestionAckResult
  >
  [RpcMethod.ModelPullSubmit]: RpcDefinition<
    ModelPullSubmitRequest,
    ModelPullSubmitResult
  >
  [RpcMethod.ModelPullGet]: RpcDefinition<
    ModelPullGetRequest,
    ModelPullGetResult
  >
  [RpcMethod.ModelPullCancel]: RpcDefinition<
    ModelPullCancelRequest,
    ModelPullCancelResult
  >
  [RpcMethod.ModelPullListActive]: RpcDefinition<
    ModelPullListActiveRequest,
    ModelPullListActiveResult
  >
  [RpcMethod.DiagnosticsRun]: RpcDefinition<
    DiagnosticsRunRequest,
    DiagnosticsRunResult
  >
  [RpcMethod.DiagnosticsGetBundle]: RpcDefinition<
    DiagnosticsGetBundleRequest,
    DiagnosticsGetBundleResult
  >
  [RpcMethod.DiagnosticsClear]: RpcDefinition<
    DiagnosticsClearRequest,
    DiagnosticsClearResult
  >
  [RpcMethod.AgentForgetChatRows]: RpcDefinition<
    AgentForgetChatRowsRequest,
    AgentForgetChatRowsResult
  >
  [RpcMethod.AgentGetRun]: RpcDefinition<AgentGetRunRequest, AgentGetRunResult>
  [RpcMethod.AgentGetReadiness]: RpcDefinition<
    AgentGetReadinessRequest,
    AgentGetReadinessResult
  >
}

export type RpcRequest<M extends RpcMethod> = RpcMap[M]["request"]
export type RpcResponse<M extends RpcMethod> = RpcMap[M]["response"]
