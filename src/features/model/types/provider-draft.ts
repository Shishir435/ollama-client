import type { PublicProviderConfig } from "@ollama-client/contracts/provider-rpc"
import {
  type OpenAICompatibilityOptions,
  ProviderServiceProfile,
  ProviderType
} from "@/lib/providers/types"

export type ProviderApiKeyDraft =
  | { state: "unchanged" }
  | { state: "replaced"; value: string }
  | { state: "cleared" }

/** Credential-safe editable provider state owned by the settings UI. */
export interface ProviderDraft {
  id: string
  type: ProviderType
  enabled: boolean
  baseUrl?: string
  modelId?: string
  name: string
  customModels?: string[]
  serviceProfile?: ProviderServiceProfile
  compatibility?: OpenAICompatibilityOptions
  hasApiKey: boolean
  apiKey: ProviderApiKeyDraft
}

export type ProviderDraftUpdate = Partial<Omit<ProviderDraft, "apiKey">> & {
  apiKey?: string
}

export const providerDraftFromPublic = (
  provider: PublicProviderConfig
): ProviderDraft => ({
  id: provider.id,
  type:
    provider.type === "ollama"
      ? ProviderType.OLLAMA
      : provider.type === "openai"
        ? ProviderType.OPENAI
        : provider.type === "anthropic"
          ? ProviderType.ANTHROPIC
          : ProviderType.CUSTOM,
  enabled: provider.enabled,
  name: provider.name,
  hasApiKey: provider.hasApiKey,
  apiKey: { state: "unchanged" },
  ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}),
  ...(provider.modelId !== undefined ? { modelId: provider.modelId } : {}),
  ...(provider.customModels !== undefined
    ? { customModels: provider.customModels }
    : {}),
  ...(provider.serviceProfile !== undefined
    ? {
        serviceProfile:
          provider.serviceProfile === "openai"
            ? ProviderServiceProfile.OPENAI
            : provider.serviceProfile === "anthropic"
              ? ProviderServiceProfile.ANTHROPIC
              : provider.serviceProfile === "openrouter"
                ? ProviderServiceProfile.OPENROUTER
                : ProviderServiceProfile.GENERIC
      }
    : {}),
  ...(provider.compatibility !== undefined
    ? { compatibility: provider.compatibility }
    : {})
})

export const providerDraftApiKeyValue = (draft: ProviderDraft): string =>
  draft.apiKey.state === "replaced" ? draft.apiKey.value : ""

export const providerDraftHasUsableApiKey = (draft: ProviderDraft): boolean => {
  if (draft.apiKey.state === "replaced")
    return Boolean(draft.apiKey.value.trim())
  if (draft.apiKey.state === "cleared") return false
  return draft.hasApiKey
}
