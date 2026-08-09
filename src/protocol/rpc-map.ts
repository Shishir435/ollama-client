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
import type {
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

/** Application-wide composition of package-owned RPC method contracts. */
export interface RpcMap {
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
}

export type RpcRequest<M extends RpcMethod> = RpcMap[M]["request"]
export type RpcResponse<M extends RpcMethod> = RpcMap[M]["response"]
