import { ConfigStore } from "./config"
import type { ProviderClient } from "./providers/base"
import { createProviderClient } from "./providers/factory"
import type { RuntimeConfig } from "./types"

export class RuntimeContext {
  constructor(private readonly configStore = new ConfigStore()) {}

  async getConfig(): Promise<RuntimeConfig> {
    return this.configStore.load()
  }

  async saveConfig(config: RuntimeConfig): Promise<void> {
    await this.configStore.save(config)
  }

  async getProviderById(providerId: string): Promise<ProviderClient> {
    const config = await this.getConfig()
    const providerConfig = config.providers.find((p) => p.id === providerId)
    if (!providerConfig) {
      throw new Error(`Provider not found: ${providerId}`)
    }
    return createProviderClient(providerConfig)
  }

  async resolveProviderForModel(
    modelId: string,
    preferredProviderId?: string
  ): Promise<ProviderClient> {
    const config = await this.getConfig()

    const chosenProviderId =
      preferredProviderId ||
      config.modelMappings[modelId] ||
      config.defaultProviderId ||
      "ollama"

    const providerConfig = config.providers.find(
      (p) => p.id === chosenProviderId
    )
    if (!providerConfig) {
      throw new Error(
        `Resolved provider "${chosenProviderId}" is not configured for model "${modelId}"`
      )
    }

    if (!providerConfig.enabled) {
      throw new Error(
        `Resolved provider "${chosenProviderId}" is disabled. Enable it in ${this.configStore.path}.`
      )
    }

    return createProviderClient(providerConfig)
  }

  async getEnabledProviders(): Promise<ProviderClient[]> {
    const config = await this.getConfig()
    return config.providers
      .filter((provider) => provider.enabled)
      .map((provider) => createProviderClient(provider))
  }

  getConfigPath(): string {
    return this.configStore.path
  }
}
