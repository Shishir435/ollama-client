import { type ProviderCapabilities, ProviderId } from "./types"

export type ModelCapabilitySource =
  | "user-override"
  | "model-metadata"
  | "provider-default"

/**
 * How much to trust a resolved capability set:
 * - "high":   read from real model metadata (e.g. Ollama /api/show tags)
 * - "medium": inferred from partial model metadata (e.g. LM Studio model type)
 * - "low":    provider-default fallback only; the model itself was not inspected
 */
export type ModelCapabilityConfidence = "high" | "medium" | "low"

export interface ModelCapabilities {
  text: boolean
  vision: boolean
  embeddings: boolean
  toolCalling: boolean
  reasoning: boolean
  /** Context window in tokens, when known from model metadata. */
  contextLength?: number
  source: ModelCapabilitySource
  confidence: ModelCapabilityConfidence
}

/**
 * The capability fields a user can manually set for a model. Every field is
 * optional — only the ones the user explicitly sets are applied, the rest fall
 * back to detection. This is how providers that cannot report capabilities
 * (everything except Ollama) get vision/tool support turned on.
 */
export interface ModelCapabilityOverride {
  text?: boolean
  vision?: boolean
  embeddings?: boolean
  toolCalling?: boolean
  reasoning?: boolean
  contextLength?: number
}

/** The capability flags an override can carry (excludes contextLength). */
const OVERRIDABLE_FLAGS = [
  "text",
  "vision",
  "embeddings",
  "toolCalling",
  "reasoning"
] as const

/**
 * Inputs to model-level capability detection. All metadata fields are optional:
 * a missing field means "unknown", which resolves to `false` (never silently
 * `true`) per the capability-detection contract — only an explicit user
 * override may flip an unknown capability on.
 */
export interface ModelCapabilityInput {
  providerId: string | ProviderId
  /** Ollama /api/show capability tags, when available. */
  ollamaCapabilities?: string[]
  /** LM Studio model type: "llm" | "vlm" | "embeddings". */
  lmStudioModelType?: string
  /** Context window length in tokens, when known. */
  contextLength?: number
  /** User-set capability override for this model, if any. */
  override?: ModelCapabilityOverride | null
}

// LM Studio /api/v0/models model `type` values.
const LM_STUDIO_TYPE_VLM = "vlm"
const LM_STUDIO_TYPE_EMBEDDINGS = "embeddings"

// Ollama /api/show capability tag → normalized capability.
const OLLAMA_CAP_COMPLETION = "completion"
const OLLAMA_CAP_INSERT = "insert"
const OLLAMA_CAP_VISION = "vision"
const OLLAMA_CAP_EMBEDDING = "embedding"
const OLLAMA_CAP_TOOLS = "tools"
const OLLAMA_CAP_THINKING = "thinking"

/**
 * Detect capabilities from whatever the provider can tell us about the model,
 * before any user override is applied.
 *
 * Sources, in order of preference:
 * - Ollama `/api/show` capability tags → high confidence.
 * - LM Studio model `type` (`vlm`/`embeddings`/`llm`) → medium confidence.
 * - Provider-level defaults → low confidence (the model itself was not
 *   inspected; this is the case the manual override exists to fix).
 *
 * Unknown capabilities resolve to `false` — the UI must not enable a feature
 * (vision input, tool calling) on a guess.
 */
const detectModelCapabilities = (
  input: ModelCapabilityInput
): ModelCapabilities => {
  const tags = input.ollamaCapabilities
  if (tags && tags.length > 0) {
    const has = (tag: string) => tags.includes(tag)
    return {
      text: has(OLLAMA_CAP_COMPLETION) || has(OLLAMA_CAP_INSERT),
      vision: has(OLLAMA_CAP_VISION),
      embeddings: has(OLLAMA_CAP_EMBEDDING),
      toolCalling: has(OLLAMA_CAP_TOOLS),
      reasoning: has(OLLAMA_CAP_THINKING),
      contextLength: input.contextLength,
      source: "model-metadata",
      confidence: "high"
    }
  }

  const providerCaps = getProviderCapabilities(input.providerId)
  const lmType = input.lmStudioModelType?.toLowerCase()
  if (lmType) {
    const isEmbeddings = lmType === LM_STUDIO_TYPE_EMBEDDINGS
    const isVlm = lmType === LM_STUDIO_TYPE_VLM
    return {
      text: !isEmbeddings,
      vision: isVlm,
      embeddings: isEmbeddings,
      // The model type does not reveal tool/reasoning support; defer to the
      // provider default rather than guessing.
      toolCalling: providerCaps?.toolCalling ?? false,
      reasoning: false,
      contextLength: input.contextLength,
      source: "model-metadata",
      confidence: "medium"
    }
  }

  const isOllama = input.providerId === ProviderId.OLLAMA

  return {
    text: providerCaps?.chat ?? true,
    vision: false,
    embeddings: providerCaps?.embeddings ?? false,
    // Ollama supports tool transport, but model support is tag-based. If
    // /api/show metadata is missing, keep model-level tools off.
    toolCalling: isOllama ? false : (providerCaps?.toolCalling ?? false),
    reasoning: false,
    contextLength: input.contextLength,
    source: "provider-default",
    confidence: "low"
  }
}

/**
 * Resolve normalized, model-level capabilities, applying any user override on
 * top of detection. Resolution order: user override → model metadata →
 * provider default.
 *
 * An override wins per-field: fields the user set are taken verbatim (the user
 * has asserted them), fields they left unset fall back to detection. When any
 * flag is overridden the result is marked `source: "user-override"` /
 * `confidence: "high"`, because the user-asserted facts now lead the set.
 */
export const getModelCapabilities = (
  input: ModelCapabilityInput
): ModelCapabilities => {
  const detected = detectModelCapabilities(input)
  const override = input.override
  if (!override) return detected

  const merged: ModelCapabilities = { ...detected }
  let overrodeFlag = false

  for (const flag of OVERRIDABLE_FLAGS) {
    const value = override[flag]
    if (typeof value === "boolean") {
      merged[flag] = value
      overrodeFlag = true
    }
  }

  if (typeof override.contextLength === "number") {
    merged.contextLength = override.contextLength
  }

  if (overrodeFlag) {
    merged.source = "user-override"
    merged.confidence = "high"
  }

  return merged
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
    toolCalling: true
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
  [ProviderId.OPENAI]: { ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES }
}

export const getProviderCapabilities = (
  providerId: string | ProviderId
): ProviderCapabilities | null => {
  const capabilities = PROVIDER_CAPABILITIES[providerId as ProviderId]
  return capabilities ? { ...capabilities } : null
}
