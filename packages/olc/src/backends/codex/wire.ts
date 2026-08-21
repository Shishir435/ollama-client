/** Codex app-server mappings kept separate from the backend lifecycle. */

import type {
  BridgeToolDefinition,
  OpenAIToolDefinition,
  ReasoningEffort
} from "../../types.js"
import { REASONING_EFFORTS } from "../../types.js"
import { isRecord } from "../../util.js"
import type { CatalogModel } from "../types.js"

export interface CodexModel {
  id: string
  model?: string
  displayName?: string
  hidden?: boolean
  supportedReasoningEfforts?: Array<{
    reasoningEffort?: string
    description?: string
  }>
  defaultReasoningEffort?: string
  inputModalities?: string[]
  isDefault?: boolean
}

const isReasoningEffort = (value: string): value is ReasoningEffort =>
  REASONING_EFFORTS.includes(value as ReasoningEffort)

export const codexReasoningEfforts = (model: CodexModel): ReasoningEffort[] =>
  (model.supportedReasoningEfforts ?? [])
    .map((option) => option.reasoningEffort ?? "")
    .filter(isReasoningEffort)

export const resolveCodexReasoningEffort = (
  models: CodexModel[],
  modelId: string,
  effort: ReasoningEffort
): { effort: ReasoningEffort } | { error: string } => {
  const model = models.find(
    (candidate) => candidate.id === modelId || candidate.model === modelId
  )
  const supported = model ? codexReasoningEfforts(model) : []
  if (supported.includes(effort)) return { effort }
  const id = `codex/${modelId}`
  return {
    error:
      supported.length > 0
        ? `Model '${id}' does not support reasoning effort '${effort}'. Supported efforts: ${supported.join(", ")}.`
        : `Model '${id}' does not report any selectable reasoning-effort variants.`
  }
}

export const mapCodexModel = (
  model: CodexModel,
  supportsTools = true
): CatalogModel => {
  const efforts = codexReasoningEfforts(model)
  const defaultEffort = model.defaultReasoningEffort
  const modalities = model.inputModalities?.length
    ? model.inputModalities
    : ["text", "image"]
  return {
    id: `codex/${model.id}`,
    object: "model",
    created: 0,
    owned_by: "codex",
    name: model.displayName || model.id,
    input_modalities: modalities,
    supported_parameters: [
      ...(supportsTools ? ["tools"] : []),
      ...(efforts.length > 0 ? ["reasoning"] : [])
    ],
    capabilities: {
      function_calling: supportsTools,
      vision: modalities.includes("image"),
      reasoning: efforts.length > 0
    },
    ...(efforts.length > 0
      ? {
          reasoning: {
            supported_efforts: efforts,
            ...(defaultEffort && isReasoningEffort(defaultEffort)
              ? { default_effort: defaultEffort }
              : {})
          }
        }
      : {})
  }
}

export const normalizeCodexTools = (tools: unknown): BridgeToolDefinition[] => {
  if (!Array.isArray(tools)) return []
  const definitions: BridgeToolDefinition[] = []
  const names = new Set<string>()
  for (const entry of tools as OpenAIToolDefinition[]) {
    const fn = isRecord(entry) ? entry.function : undefined
    const name =
      isRecord(fn) && typeof fn.name === "string" ? fn.name.trim() : ""
    if (!name || names.has(name)) continue
    names.add(name)
    definitions.push({
      name,
      description:
        isRecord(fn) && typeof fn.description === "string"
          ? fn.description
          : "",
      parameters: isRecord(fn) && isRecord(fn.parameters) ? fn.parameters : {}
    })
  }
  return definitions
}

export const toDynamicTools = (tools: unknown) =>
  normalizeCodexTools(tools).map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters
  }))
