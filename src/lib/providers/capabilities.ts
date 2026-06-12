import { type ProviderCapabilities, ProviderId } from "./types"

export type ModelCapabilitySource = "provider-default" | "model-metadata"

export interface ModelCapabilities {
  text: boolean
  vision: boolean
  embeddings: boolean
  toolCalling: boolean
  source: ModelCapabilitySource
}

export const OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  embeddings: true,
  modelDiscovery: true,
  modelDetails: false,
  modelPull: false,
  modelUnload: false,
  modelDelete: false,
  providerVersion: false,
  toolCalling: false
}

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  [ProviderId.OLLAMA]: {
    chat: true,
    embeddings: true,
    modelDiscovery: true,
    modelDetails: true,
    modelPull: true,
    modelUnload: true,
    modelDelete: true,
    providerVersion: true,
    toolCalling: false
  },
  [ProviderId.LM_STUDIO]: {
    ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES,
    modelPull: true,
    modelUnload: true,
    providerVersion: false,
    toolCalling: true
  },
  [ProviderId.LLAMA_CPP]: {
    ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES,
    modelPull: false,
    modelUnload: false,
    modelDelete: false,
    providerVersion: false,
    toolCalling: true
  },
  [ProviderId.VLLM]: {
    ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES,
    toolCalling: true
  },
  [ProviderId.LOCALAI]: {
    ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES,
    toolCalling: true
  },
  [ProviderId.KOBOLDCPP]: {
    ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES,
    toolCalling: true
  },
  [ProviderId.OPENAI]: OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES
}

export const getProviderCapabilities = (
  providerId: string | ProviderId
): ProviderCapabilities | null => {
  const capabilities = PROVIDER_CAPABILITIES[providerId as ProviderId]
  return capabilities ? { ...capabilities } : null
}
