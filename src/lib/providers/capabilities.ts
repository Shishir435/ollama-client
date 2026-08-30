import {
  customProviderWireFromId,
  type ProviderCapabilities,
  ProviderId
} from "./types"

export type ModelCapabilitySource =
  | "user-override"
  | "probed"
  | "model-metadata"
  | "provider-default"

/**
 * How much to trust a resolved capability set:
 * - "high":   read from real model metadata (e.g. Ollama /api/show tags)
 * - "medium": inferred from partial model metadata (e.g. LM Studio model type)
 *             or confirmed empirically by a capability probe
 * - "low":    provider-default fallback only; the model itself was not inspected
 */
export type ModelCapabilityConfidence = "high" | "medium" | "low"

export type CapabilityStatus = "supported" | "unsupported" | "unknown"

export interface ModelCapabilityState {
  status: CapabilityStatus
  source: ModelCapabilitySource
  confidence: ModelCapabilityConfidence
}

export type ModelCapabilityStates = Record<
  | "text"
  | "vision"
  | "imageOutput"
  | "embeddings"
  | "toolCalling"
  | "reasoning",
  ModelCapabilityState
>

export interface ModelCapabilities {
  text: boolean
  vision: boolean
  imageOutput: boolean
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
  imageOutput?: boolean
  embeddings?: boolean
  toolCalling?: boolean
  reasoning?: boolean
  contextLength?: number
}

/** The capability flags an override can carry (excludes contextLength). */
const OVERRIDABLE_FLAGS = [
  "text",
  "vision",
  "imageOutput",
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
  /**
   * Capability tags a list endpoint reports for the model itself, e.g. LM
   * Studio's `["tool_use"]`. Reported support rather than inferred, so it
   * outranks the provider default for the flags it covers.
   */
  capabilityTags?: string[]
  /** Context window length in tokens, when known. */
  contextLength?: number
  /** Modalities reported by model catalogs such as OpenRouter. */
  modalities?: string[]
  /** Output modalities reported independently from input modalities. */
  outputModalities?: string[]
  /** Supported request parameters reported by the model catalog. */
  supportedParameters?: string[]
  /** User-set capability override for this model, if any. */
  override?: ModelCapabilityOverride | null
  /**
   * Empirical probe result for this model, if any (see `capability-probe.ts`).
   * Applied between the user override and detection: a probe is evidence from
   * the actual server, so it beats static metadata — but never a user's word.
   */
  probed?: {
    toolCalling?: boolean
    reasoning?: boolean
    vision?: boolean
  } | null
}

/** LM Studio /api/v0/models model `type` values. */
const LM_STUDIO_TYPE_VLM = "vlm"
const LM_STUDIO_TYPE_EMBEDDINGS = "embeddings"

/**
 * LM Studio /api/v0/models `capabilities[]` tag.
 *
 * "tool_use" is the only value a live server was observed to emit, and the
 * vocabulary demonstrably does not cover reasoning: `qwen3-4b-thinking-2507`
 * reports exactly ["tool_use"] while streaming `reasoning_content`, as does
 * `gemma-4-12b`. So this list is evidence about tool calling only — the absence
 * of a tag says nothing about any other capability, and reasoning must stay
 * unknown here so a probe or override can settle it.
 */
const LM_STUDIO_CAP_TOOL_USE = "tool_use"

/** Ollama /api/show capability tag → normalized capability. */
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
const detectOllamaModelCapabilities = (
  input: ModelCapabilityInput,
  tags: string[]
): ModelCapabilities => {
  const has = (tag: string) => tags.includes(tag)
  return {
    text: has(OLLAMA_CAP_COMPLETION) || has(OLLAMA_CAP_INSERT),
    vision: has(OLLAMA_CAP_VISION),
    imageOutput:
      has("image") || has("image-generation") || has("image_generation"),
    embeddings: has(OLLAMA_CAP_EMBEDDING),
    toolCalling: has(OLLAMA_CAP_TOOLS),
    reasoning: has(OLLAMA_CAP_THINKING),
    contextLength: input.contextLength,
    source: "model-metadata",
    confidence: "high"
  }
}

const detectLmStudioCapabilities = (
  input: ModelCapabilityInput,
  providerCaps: ProviderCapabilities | null | undefined,
  lmType: string,
  tagsReported: string[] | undefined
): ModelCapabilities => {
  const isEmbeddings = lmType === LM_STUDIO_TYPE_EMBEDDINGS
  const isVlm = lmType === LM_STUDIO_TYPE_VLM
  return {
    text: !isEmbeddings,
    vision: isVlm,
    imageOutput: false,
    embeddings: isEmbeddings,
    toolCalling: tagsReported
      ? tagsReported.includes(LM_STUDIO_CAP_TOOL_USE)
      : (providerCaps?.toolCalling ?? false),
    reasoning: false,
    contextLength: input.contextLength,
    source: "model-metadata",
    confidence: "medium"
  }
}

const normalizeReportedList = (values?: string[]): string[] | undefined =>
  values?.length ? values.map((value) => value.toLowerCase()) : undefined

const detectReportedCapabilities = (
  input: ModelCapabilityInput,
  providerCaps: ProviderCapabilities | null | undefined,
  modalities: string[] | undefined,
  outputModalities: string[] | undefined,
  supportedParameters: string[] | undefined
): ModelCapabilities => {
  const supportsAnyParameter = (...names: string[]) =>
    names.some((name) => supportedParameters?.includes(name))
  return {
    text:
      modalities?.includes("text") ??
      (providerCaps?.chat === true || modalities === undefined),
    vision: modalities?.includes("image") ?? false,
    imageOutput: outputModalities?.includes("image") ?? false,
    embeddings: providerCaps?.embeddings ?? false,
    toolCalling:
      supportedParameters !== undefined
        ? supportsAnyParameter("tools", "tool_choice")
        : (providerCaps?.toolCalling ?? false),
    reasoning:
      supportedParameters !== undefined
        ? supportsAnyParameter(
            "reasoning",
            "reasoning_effort",
            "include_reasoning"
          )
        : false,
    contextLength: input.contextLength,
    source: "model-metadata",
    confidence: "high"
  }
}

const detectProviderDefaultCapabilities = (
  input: ModelCapabilityInput,
  providerCaps: ProviderCapabilities | null | undefined
): ModelCapabilities => {
  const isOllama =
    input.providerId === ProviderId.OLLAMA ||
    customProviderWireFromId(String(input.providerId)) === "ollama"
  return {
    text: providerCaps?.chat ?? true,
    vision: false,
    imageOutput: false,
    embeddings: providerCaps?.embeddings ?? false,
    toolCalling: isOllama ? false : (providerCaps?.toolCalling ?? false),
    reasoning: false,
    contextLength: input.contextLength,
    source: "provider-default",
    confidence: "low"
  }
}

const detectModelCapabilities = (
  input: ModelCapabilityInput
): ModelCapabilities => {
  const tags = input.ollamaCapabilities
  if (tags?.length) return detectOllamaModelCapabilities(input, tags)

  const providerCaps = getProviderCapabilities(input.providerId)
  const lmType = input.lmStudioModelType?.toLowerCase()
  const tagsReported = normalizeReportedList(input.capabilityTags)
  if (lmType) {
    return detectLmStudioCapabilities(input, providerCaps, lmType, tagsReported)
  }

  const modalities = normalizeReportedList(input.modalities)
  const outputModalities = normalizeReportedList(input.outputModalities)
  const supportedParameters = normalizeReportedList(input.supportedParameters)
  if (modalities || outputModalities || supportedParameters) {
    return detectReportedCapabilities(
      input,
      providerCaps,
      modalities,
      outputModalities,
      supportedParameters
    )
  }

  return detectProviderDefaultCapabilities(input, providerCaps)
}

/**
 * Resolve normalized, model-level capabilities/**
 * Resolve normalized, model-level capabilities, applying any user override on
 * top of detection. Resolution order: user override → probe result → model
 * metadata → provider default.
 *
 * An override wins per-field: fields the user set are taken verbatim (the user
 * has asserted them), fields they left unset fall back to the probe/detection.
 * When any flag is overridden the result is marked `source: "user-override"` /
 * `confidence: "high"`, because the user-asserted facts now lead the set. A
 * probe result without an override marks the set `probed`/`medium`.
 */
export const getModelCapabilities = (
  input: ModelCapabilityInput
): ModelCapabilities => {
  const detected = detectModelCapabilities(input)
  const merged: ModelCapabilities = { ...detected }
  const override = input.override

  if (typeof input.probed?.toolCalling === "boolean") {
    merged.toolCalling = input.probed.toolCalling
    merged.source = "probed"
    merged.confidence = "medium"
  }

  if (typeof input.probed?.reasoning === "boolean") {
    merged.reasoning = input.probed.reasoning
    merged.source = "probed"
    merged.confidence = "medium"
  }

  if (typeof input.probed?.vision === "boolean") {
    merged.vision = input.probed.vision
    merged.source = "probed"
    merged.confidence = "medium"
  }

  if (!override) return merged

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

const capabilityStatus = (value: boolean): CapabilityStatus =>
  value ? "supported" : "unsupported"

/**
 * Source-aware capability contract for new consumers. Existing UI can keep
 * using `getModelCapabilities` booleans during migration; new RPC/enforcement
 * code can distinguish a real negative from missing evidence.
 */
const metadataOwnsCapabilityFlag = (
  flag: keyof Pick<
    ModelCapabilities,
    | "text"
    | "vision"
    | "imageOutput"
    | "embeddings"
    | "toolCalling"
    | "reasoning"
  >,
  input: ModelCapabilityInput
): boolean => {
  const tagsAvailable = Boolean(input.ollamaCapabilities?.length)
  if (tagsAvailable) return true
  if (input.modalities?.length && (flag === "text" || flag === "vision"))
    return true
  if (input.outputModalities?.length && flag === "imageOutput") return true
  if (
    input.supportedParameters?.length &&
    (flag === "toolCalling" || flag === "reasoning")
  ) {
    return true
  }
  const lmTypeAvailable = Boolean(input.lmStudioModelType)
  if (
    lmTypeAvailable &&
    (flag === "text" || flag === "vision" || flag === "embeddings")
  ) {
    return true
  }
  return Boolean(
    lmTypeAvailable && input.capabilityTags?.length && flag === "toolCalling"
  )
}

const explicitCapabilityState = (
  flag: keyof Pick<
    ModelCapabilities,
    | "text"
    | "vision"
    | "imageOutput"
    | "embeddings"
    | "toolCalling"
    | "reasoning"
  >,
  input: ModelCapabilityInput
): ModelCapabilityState | undefined => {
  const override = input.override?.[flag]
  if (typeof override === "boolean") {
    return {
      status: capabilityStatus(override),
      source: "user-override",
      confidence: "high"
    }
  }
  const probed =
    flag === "toolCalling" || flag === "reasoning" || flag === "vision"
      ? input.probed?.[flag]
      : undefined
  if (typeof probed !== "boolean") return undefined
  return {
    status: capabilityStatus(probed),
    source: "probed",
    confidence: "medium"
  }
}

const providerDefaultCapabilityState = (
  flag: keyof Pick<
    ModelCapabilities,
    | "text"
    | "vision"
    | "imageOutput"
    | "embeddings"
    | "toolCalling"
    | "reasoning"
  >,
  providerCaps: ProviderCapabilities | null | undefined
): ModelCapabilityState => {
  const providerValue =
    flag === "text"
      ? providerCaps?.chat
      : flag === "embeddings"
        ? providerCaps?.embeddings
        : flag === "toolCalling"
          ? providerCaps?.toolCalling
          : undefined
  return {
    status:
      typeof providerValue === "boolean"
        ? capabilityStatus(providerValue)
        : "unknown",
    source: "provider-default",
    confidence: "low"
  }
}

export const getModelCapabilityStates = (
  input: ModelCapabilityInput
): ModelCapabilityStates => {
  const resolved = getModelCapabilities(input)
  const flags = [
    "text",
    "vision",
    "imageOutput",
    "embeddings",
    "toolCalling",
    "reasoning"
  ] as const
  const states = {} as ModelCapabilityStates
  const providerCaps = getProviderCapabilities(input.providerId)

  for (const flag of flags) {
    const explicit = explicitCapabilityState(flag, input)
    if (explicit) {
      states[flag] = explicit
      continue
    }
    if (metadataOwnsCapabilityFlag(flag, input)) {
      states[flag] = {
        status: capabilityStatus(resolved[flag]),
        source: "model-metadata",
        confidence: resolved.confidence
      }
      continue
    }
    states[flag] = providerDefaultCapabilityState(flag, providerCaps)
  }
  return states
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

export const ANTHROPIC_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  embeddings: false,
  modelDiscovery: true,
  modelDetails: false,
  modelPull: false,
  modelUnload: false,
  modelDelete: false,
  providerVersion: false,
  toolCalling: true
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
    // Server transport support is not model/template support. Keep this off
    // until a model-level probe or user override proves a complete tool loop.
    toolCalling: false
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
  if (capabilities) return { ...capabilities }

  // Custom providers carry their wire protocol in the id; resolve provider-level
  // defaults from it. Tool calling stays off at the provider level — the
  // per-model resolution chain (override → probe → metadata) turns it on.
  const wire = customProviderWireFromId(String(providerId))
  if (wire === "ollama") {
    return { ...PROVIDER_CAPABILITIES[ProviderId.OLLAMA], toolCalling: true }
  }
  if (wire === "openai") {
    return { ...OPENAI_COMPATIBLE_PROVIDER_CAPABILITIES, toolCalling: true }
  }
  if (wire === "anthropic") {
    return { ...ANTHROPIC_PROVIDER_CAPABILITIES }
  }
  return null
}
