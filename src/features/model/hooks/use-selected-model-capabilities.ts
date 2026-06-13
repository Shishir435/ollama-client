import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import {
  getModelCapabilities,
  type ModelCapabilities
} from "@/lib/providers/capabilities"
import { useModelCapabilityOverrides } from "./use-model-capability-overrides"
import { useModelInfo } from "./use-model-info"
import { useProviderModels } from "./use-provider-models"

/**
 * Resolved capabilities of the currently selected chat model, applying the same
 * override → metadata → provider-default chain used in the model menu. Drives
 * feature gating in the composer (e.g. image attach requires `vision`).
 *
 * For Ollama the high-confidence capability tags come from `useModelInfo`
 * (`/api/show`), which is cached and shared with the model-detail panel.
 */
export const useSelectedModelCapabilities = (): ModelCapabilities | null => {
  const { models, selectedModel, selectedProviderId } = useProviderModels()
  const { modelInfo } = useModelInfo(selectedModel, selectedProviderId)
  const { getOverride } = useModelCapabilityOverrides()

  if (!selectedModel) return null

  const providerId = selectedProviderId || DEFAULT_PROVIDER_ID
  const model = models.find(
    (m) =>
      m.name === selectedModel &&
      (m.providerId || DEFAULT_PROVIDER_ID) === providerId
  )
  const ollamaCapabilities = (modelInfo as { capabilities?: string[] } | null)
    ?.capabilities

  return getModelCapabilities({
    providerId,
    ollamaCapabilities,
    lmStudioModelType: model?.capabilityHints?.modelType,
    contextLength: model?.capabilityHints?.contextLength,
    override: getOverride(providerId, selectedModel)
  })
}
