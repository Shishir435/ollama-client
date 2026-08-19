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

  const supportedParameters: string[] = []
  if (capabilities.toolcall === true) supportedParameters.push("tools")
  if (capabilities.reasoning === true) supportedParameters.push("reasoning")
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
      reasoning: capabilities.reasoning === true
    },
    ...(typeof model.status === "string" ? { status: model.status } : {})
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
