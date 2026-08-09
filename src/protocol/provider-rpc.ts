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

export * from "@ollama-client/contracts/provider-rpc"

/** Application-wide RPC map; other protocol domains augment this interface. */
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
}

export type RpcRequest<M extends RpcMethod> = RpcMap[M]["request"]
export type RpcResponse<M extends RpcMethod> = RpcMap[M]["response"]
