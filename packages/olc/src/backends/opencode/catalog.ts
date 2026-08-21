/**
 * Maps OpenCode's provider catalog into OpenAI-compatible model entries.
 *
 * Contract: capability facts come from OpenCode's own model metadata and are
 * published in the fields OpenAI-compatible clients already read — `capabilities`,
 * `supported_parameters`, `input_modalities`, `context_length`. A client can then
 * decide whether to send tools or images the same way it does for any other
 * endpoint, instead of being told to assume.
 *
 * Note: an empty catalog is reported as empty. Inventing a placeholder model id puts
 * a model in the client's menu that no request can ever reach.
 */

import { REASONING_EFFORTS, type ReasoningEffort } from "../../types.js"
import { isRecord } from "../../util.js"
import type { CatalogModel } from "../types.js"

/** Normalize `/config/providers` into a list, whichever shape it arrives in. */
export const normalizeProviders = (raw: unknown): Record<string, unknown>[] => {
  if (Array.isArray(raw)) return raw.filter(isRecord)
  if (isRecord(raw)) {
    return Object.entries(raw).map(([id, info]) => ({
      ...(isRecord(info) ? info : {}),
      id
    }))
  }
  return []
}

const modalitiesOf = (input: unknown): string[] => {
  if (!isRecord(input)) return ["text"]
  const modalities = ["text", "image", "audio", "video", "pdf"].filter(
    (modality) => input[modality] === true
  )
  return modalities.length > 0 ? modalities : ["text"]
}

const reasoningEffortsOf = (input: unknown): ReasoningEffort[] => {
  const ids = new Set<string>()
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === "string") ids.add(entry)
      else if (isRecord(entry) && typeof entry.id === "string")
        ids.add(entry.id)
    }
  } else if (isRecord(input)) {
    for (const id of Object.keys(input)) ids.add(id)
  }
  return REASONING_EFFORTS.filter((effort) => ids.has(effort))
}

const reasoningMetadata = (
  variants: unknown,
  defaultVariant?: unknown
): CatalogModel["reasoning"] => {
  const supportedEfforts = reasoningEffortsOf(variants)
  if (supportedEfforts.length === 0) return undefined
  const defaultEffort =
    typeof defaultVariant === "string" &&
    supportedEfforts.includes(defaultVariant as ReasoningEffort)
      ? (defaultVariant as ReasoningEffort)
      : undefined
  return {
    supported_efforts: supportedEfforts,
    ...(defaultEffort ? { default_effort: defaultEffort } : {})
  }
}

/** Map one OpenCode model into an OpenAI-compatible catalog entry. */
export const mapModel = (
  providerId: string,
  modelId: string,
  info: unknown
): CatalogModel => {
  const model = isRecord(info) ? info : {}
  const capabilities = isRecord(model.capabilities) ? model.capabilities : {}
  const limit = isRecord(model.limit) ? model.limit : {}
  const modalities = modalitiesOf(capabilities.input)
  const reasoning = reasoningMetadata(model.variants, model.variant)

  const supportedParameters: string[] = []
  if (capabilities.toolcall === true) supportedParameters.push("tools")
  if (capabilities.reasoning === true || reasoning) {
    supportedParameters.push("reasoning")
  }
  if (capabilities.temperature === true) supportedParameters.push("temperature")

  const contextLength =
    typeof limit.context === "number" && limit.context > 0
      ? limit.context
      : undefined
  const maxTokens =
    typeof limit.output === "number" && limit.output > 0
      ? limit.output
      : undefined

  return {
    id: `${providerId}/${modelId}`,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: providerId,
    name: typeof model.name === "string" && model.name ? model.name : modelId,
    ...(contextLength === undefined ? {} : { context_length: contextLength }),
    ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    input_modalities: modalities,
    supported_parameters: supportedParameters,
    capabilities: {
      function_calling: capabilities.toolcall === true,
      vision: modalities.includes("image"),
      reasoning: capabilities.reasoning === true || Boolean(reasoning)
    },
    ...(reasoning ? { reasoning } : {}),
    ...(typeof model.status === "string" ? { status: model.status } : {})
  }
}

/** Map one OpenCode v2 `/api/model` entry, including exact variants. */
export const mapV2Model = (info: unknown): CatalogModel | null => {
  if (!isRecord(info)) return null
  const providerId =
    typeof info.providerID === "string" ? info.providerID.trim() : ""
  const modelId = typeof info.id === "string" ? info.id.trim() : ""
  if (!providerId || !modelId) return null

  const capabilities = isRecord(info.capabilities) ? info.capabilities : {}
  const limit = isRecord(info.limit) ? info.limit : {}
  const request = isRecord(info.request) ? info.request : {}
  const modalities = Array.isArray(capabilities.input)
    ? capabilities.input.filter(
        (value): value is string => typeof value === "string"
      )
    : ["text"]
  const reasoning = reasoningMetadata(info.variants, request.variant)
  const supportedParameters: string[] = []
  if (capabilities.tools === true) supportedParameters.push("tools")
  if (reasoning) supportedParameters.push("reasoning")

  return {
    id: `${providerId}/${modelId}`,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: providerId,
    name: typeof info.name === "string" && info.name ? info.name : modelId,
    ...(typeof limit.context === "number" && limit.context > 0
      ? { context_length: limit.context }
      : {}),
    ...(typeof limit.output === "number" && limit.output > 0
      ? { max_tokens: limit.output }
      : {}),
    input_modalities: modalities.length > 0 ? modalities : ["text"],
    supported_parameters: supportedParameters,
    capabilities: {
      function_calling: capabilities.tools === true,
      vision: modalities.includes("image"),
      reasoning: Boolean(reasoning)
    },
    ...(reasoning ? { reasoning } : {}),
    ...(typeof info.status === "string" ? { status: info.status } : {})
  }
}

export const collectV2Models = (raw: unknown): CatalogModel[] =>
  Array.isArray(raw)
    ? raw
        .map((model) => mapV2Model(model))
        .filter((model): model is CatalogModel => model !== null)
    : []

/**
 * OpenCode 1.18 can return a complete v2 model list while omitting variants
 * that remain present in its legacy provider catalog. Keep v2 as the model
 * authority and use the legacy catalog only to restore exact reasoning facts.
 */
export const mergeReasoningMetadata = (
  models: CatalogModel[],
  legacyModels: CatalogModel[]
): CatalogModel[] => {
  const legacyById = new Map(legacyModels.map((model) => [model.id, model]))
  return models.map((model) => {
    if (model.reasoning) return model
    const reasoning = legacyById.get(model.id)?.reasoning
    if (!reasoning) return model
    return {
      ...model,
      supported_parameters: Array.from(
        new Set([...model.supported_parameters, "reasoning"])
      ),
      capabilities: { ...model.capabilities, reasoning: true },
      reasoning
    }
  })
}

export const resolveReasoningVariant = (
  models: CatalogModel[],
  target: { providerId: string; modelId: string },
  effort: ReasoningEffort
): { variant: ReasoningEffort } | { error: string } => {
  const id = `${target.providerId}/${target.modelId}`
  const model = models.find((candidate) => candidate.id === id)
  const supported = model?.reasoning?.supported_efforts ?? []
  if (supported.includes(effort)) return { variant: effort }
  return {
    error:
      supported.length > 0
        ? `Model '${id}' does not support reasoning effort '${effort}'. Supported efforts: ${supported.join(", ")}.`
        : `Model '${id}' does not report any selectable reasoning-effort variants.`
  }
}

/** Every model of every configured OpenCode provider, in catalog order. */
export const collectModels = (raw: unknown): CatalogModel[] => {
  const models: CatalogModel[] = []
  for (const provider of normalizeProviders(raw)) {
    const providerId =
      typeof provider.id === "string" && provider.id ? provider.id : null
    if (!providerId || !isRecord(provider.models)) continue
    for (const [modelId, info] of Object.entries(provider.models)) {
      models.push(mapModel(providerId, modelId, info))
    }
  }
  return models
}

/**
 * Resolve a requested model id to a provider and model.
 *
 * A `provider/model` id is taken as given. A bare model id is looked up in the
 * catalog rather than attached to an assumed default provider, because the wrong
 * provider is a silent routing error instead of a visible failure.
 */
export const resolveModelId = async (
  requested: unknown,
  loadModels: () => Promise<CatalogModel[]>
): Promise<{ providerId: string; modelId: string } | { error: string }> => {
  const raw = typeof requested === "string" ? requested.trim() : ""
  if (!raw) return { error: "A model id is required, as `provider/model`." }

  const separator = raw.indexOf("/")
  if (separator > 0 && separator < raw.length - 1) {
    return {
      providerId: raw.slice(0, separator),
      modelId: raw.slice(separator + 1)
    }
  }

  let models: CatalogModel[] = []
  try {
    models = await loadModels()
  } catch (error) {
    return {
      error: `Model '${raw}' has no provider prefix and the catalog could not be read: ${(error as Error).message}`
    }
  }
  const matches = models.filter((model) => model.id.endsWith(`/${raw}`))
  if (matches.length === 1) {
    const id = (matches[0] as CatalogModel).id
    const separatorIndex = id.indexOf("/")
    return {
      providerId: id.slice(0, separatorIndex),
      modelId: id.slice(separatorIndex + 1)
    }
  }
  if (matches.length > 1) {
    return {
      error: `Model '${raw}' is served by several providers (${matches
        .map((model) => model.id)
        .join(", ")}). Use the full 'provider/model' id.`
    }
  }
  return {
    error: `Model '${raw}' is not in the catalog. Use a 'provider/model' id from /v1/models.`
  }
}
