import { createAppError } from "@/lib/error-utils"
import { resolveProviderBaseUrl } from "./base-url"
import type { LLMProvider } from "./types"

export const assertProviderEnabled = (
  provider: LLMProvider,
  model?: string
): void => {
  if (provider.config.enabled) return

  throw createAppError(`${provider.config.name} is disabled`, {
    kind: "validation",
    status: 409,
    code: "OLC-PROVIDER-DISABLED",
    phase: "configuration",
    recoveryAction: "enable-provider",
    userMessage: `${provider.config.name} is disabled. Enable it in Settings → Model behavior before chatting.`,
    providerId: String(provider.id),
    providerName: provider.config.name,
    model,
    baseUrl: resolveProviderBaseUrl(provider.config)
  })
}
