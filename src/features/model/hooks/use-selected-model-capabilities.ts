import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import {
  getModelCapabilities,
  getProviderCapabilities,
  type ModelCapabilities
} from "@/lib/providers/capabilities"
import { useModelCapabilityOverrides } from "./use-model-capability-overrides"
import { useModelInfo } from "./use-model-info"
import { useProviderModels } from "./use-provider-models"

export interface SelectedModelCapabilities {
  capabilities: ModelCapabilities | null
  /**
   * True while the model's capabilities are still being detected (the Ollama
   * `/api/show` fetch). Consumers should avoid hard-blocking a capability while
   * this is true — the resolved value (`vision: false`) is not yet trustworthy
   * for self-reporting providers, which would otherwise false-block on the
   * first interaction before detection completes.
   */
  isResolving: boolean
}

/**
 * Resolved capabilities of the currently selected chat model, applying the same
 * override → metadata → provider-default chain used in the model menu. Drives
 * feature gating in the composer (e.g. image attach requires `vision`).
 *
 * For Ollama the high-confidence capability tags come from `useModelInfo`
 * (`/api/show`), which is cached and shared with the model-detail panel.
 */
export const useSelectedModelCapabilities = (): SelectedModelCapabilities => {
  const { models, selectedModel, selectedProviderId } = useProviderModels()
  const { modelInfo, loading } = useModelInfo(selectedModel, selectedProviderId)
  const { getOverride } = useModelCapabilityOverrides()

  if (!selectedModel) return { capabilities: null, isResolving: false }

  const providerId = selectedProviderId || DEFAULT_PROVIDER_ID
  const model = models.find(
    (m) =>
      m.name === selectedModel &&
      (m.providerId || DEFAULT_PROVIDER_ID) === providerId
  )
  const ollamaCapabilities = (modelInfo as { capabilities?: string[] } | null)
    ?.capabilities

  const capabilities = getModelCapabilities({
    providerId,
    ollamaCapabilities,
    lmStudioModelType: model?.capabilityHints?.modelType,
    contextLength: model?.capabilityHints?.contextLength,
    modalities: model?.capabilityHints?.modalities,
    supportedParameters: model?.capabilityHints?.supportedParameters,
    override: getOverride(providerId, selectedModel)
  })

  // Only providers that self-report can transition from unknown → known, so a
  // pending fetch only matters for them. Others resolve immediately from
  // defaults/override and never "resolve" further.
  const canSelfReport =
    getProviderCapabilities(providerId)?.modelDetails === true
  const isResolving = canSelfReport && loading

  return { capabilities, isResolving }
}
