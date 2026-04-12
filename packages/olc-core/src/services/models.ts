import type { RuntimeContext } from "../runtime"
import type { ProviderModel } from "../types"

export const listModels = async (
  runtime: RuntimeContext,
  providerId?: string
): Promise<ProviderModel[]> => {
  if (providerId) {
    const provider = await runtime.getProviderById(providerId)
    return provider.getModels()
  }

  const providers = await runtime.getEnabledProviders()
  const results = await Promise.allSettled(
    providers.map(async (provider) => provider.getModels())
  )

  const models: ProviderModel[] = []
  for (const result of results) {
    if (result.status === "fulfilled") {
      models.push(...result.value)
    }
  }

  return models
}

export const runModelOperation = async (
  runtime: RuntimeContext,
  operation: "pull" | "unload" | "delete",
  model: string,
  providerId: string
) => {
  const provider = await runtime.getProviderById(providerId)

  if (operation === "pull") {
    if (!provider.pullModel || !provider.capabilities.modelPull) {
      throw new Error(`Provider "${providerId}" does not support pull`)
    }
    await provider.pullModel(model)
    return
  }

  if (operation === "unload") {
    if (!provider.unloadModel || !provider.capabilities.modelUnload) {
      throw new Error(`Provider "${providerId}" does not support unload`)
    }
    await provider.unloadModel(model)
    return
  }

  if (!provider.deleteModel || !provider.capabilities.modelDelete) {
    throw new Error(`Provider "${providerId}" does not support delete`)
  }
  await provider.deleteModel(model)
}
