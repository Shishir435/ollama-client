import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderId } from "@/lib/providers/types"

export const getOllamaBaseUrl = async (): Promise<string> => {
  const config = await ProviderManager.getProviderConfig(ProviderId.OLLAMA)
  if (!config) {
    throw new Error("Built-in Ollama provider configuration is missing")
  }
  return resolveProviderBaseUrl(config)
}
