import type {
  ModelCapabilities,
  ModelCapabilityStates
} from "@/lib/providers/capabilities"

/**
 * Whether every turn of this model belongs to the provider's image operation.
 *
 * Image output alone does not decide it. A model with real evidence that it
 * writes text — Ollama `completion`, an LM Studio `llm`/`vlm` type, a catalog's
 * text output modality, or the user's own text override — keeps the
 * conversation, even when its image-output override was set by mistake (#454):
 * it chats with its history and tools, and any image it returns arrives inline
 * through the shared stream adapter.
 *
 * A text flag that only the provider default set is no evidence at all. An
 * OpenAI-compatible server listing `dall-e-3` by id says nothing about the
 * model, so the default reads "text: true" for it like for every other id.
 * When the user has asserted image output for such a model, their word is the
 * only evidence there is, and it goes to the image operation.
 */
export const isImageOnlyModel = (
  capabilities: Pick<ModelCapabilities, "imageOutput" | "text">,
  states?: Pick<ModelCapabilityStates, "imageOutput" | "text">
): boolean => {
  if (!capabilities.imageOutput) return false
  if (!capabilities.text) return true
  return (
    states?.imageOutput.source === "user-override" &&
    states.text.source === "provider-default"
  )
}
