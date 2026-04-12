import type {
  ChatChunk,
  ChatRequest,
  ProviderCapabilities,
  ProviderConfig,
  ProviderModel
} from "../types"

export type ChatStreamCallbacks = {
  onChunk: (chunk: ChatChunk) => void
  signal?: AbortSignal
}

export interface ProviderClient {
  readonly id: string
  readonly name: string
  readonly config: ProviderConfig
  readonly capabilities: ProviderCapabilities

  getModels(): Promise<ProviderModel[]>
  streamChat(
    request: ChatRequest,
    callbacks: ChatStreamCallbacks
  ): Promise<void>
  pullModel?(model: string, signal?: AbortSignal): Promise<void>
  unloadModel?(model: string, signal?: AbortSignal): Promise<void>
  deleteModel?(model: string, signal?: AbortSignal): Promise<void>
  getVersion?(): Promise<string | null>
  checkHealth(): Promise<void>
}

export const defaultCapabilities: ProviderCapabilities = {
  chat: true,
  modelDiscovery: true,
  modelPull: false,
  modelUnload: false,
  modelDelete: false,
  providerVersion: false
}

export abstract class BaseProvider implements ProviderClient {
  readonly id: string
  readonly name: string
  readonly config: ProviderConfig
  readonly capabilities: ProviderCapabilities

  constructor(
    config: ProviderConfig,
    capabilities?: Partial<ProviderCapabilities>
  ) {
    this.id = config.id
    this.name = config.name
    this.config = config
    this.capabilities = {
      ...defaultCapabilities,
      ...(capabilities || {})
    }
  }

  abstract getModels(): Promise<ProviderModel[]>

  abstract streamChat(
    request: ChatRequest,
    callbacks: ChatStreamCallbacks
  ): Promise<void>

  async checkHealth(): Promise<void> {
    await this.getModels()
  }
}
