import type { ProviderModel } from "@/types"

export const getModelIcon = (modelName: string): string => {
  const name = modelName.toLowerCase()
  if (name.includes("llama")) return "🦙"
  if (name.includes("mistral")) return "🌪️"
  if (name.includes("codellama")) return "💻"
  if (name.includes("phi")) return "📐"
  if (name.includes("gemma")) return "💎"
  if (name.includes("qwq")) return "🐱"
  if (isEmbeddingModel(modelName)) return "🧠"
  return "🤖"
}

export const isEmbeddingModel = (
  modelName: string,
  families: string[] = []
): boolean => {
  const name = modelName.toLowerCase()

  // Check by name patterns
  if (
    name.includes("embed") ||
    name.includes("embedding") ||
    name.includes("bge") ||
    name.includes("gte") ||
    name.includes("minilm") ||
    name.includes("sentence-transformers")
  ) {
    return true
  }

  // Check by architecture families
  const embeddingFamilies = ["bert", "nomic-bert", "xlm-roberta"]
  if (families.some((f) => embeddingFamilies.includes(f.toLowerCase()))) {
    return true
  }

  return false
}

export const formatFileSize = (
  bytes: number | string,
  t: (key: string) => string
): string => {
  if (!bytes) return t("settings.model_list.unknown_size")

  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = typeof bytes === "string" ? parseInt(bytes, 10) : bytes
  let unitIndex = 0

  if (Number.isNaN(size)) return t("settings.model_list.invalid_size")

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

const parseBillionsFromText = (value: string): number | null => {
  const normalized = value.trim().toLowerCase()
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*b/)
  if (match) return Number.parseFloat(match[1])
  return null
}

export const getModelParameterSizeBillions = (
  model: Pick<ProviderModel, "name" | "details">
): number | null => {
  const fromDetails = parseBillionsFromText(model.details?.parameter_size || "")
  if (fromDetails !== null) return fromDetails

  const fromName = parseBillionsFromText(model.name)
  if (fromName !== null) return fromName

  return null
}

export const getAgentModelWarning = (
  model: Pick<ProviderModel, "name" | "details">
): string | null => {
  const families = model.details?.families || []
  if (isEmbeddingModel(model.name, families)) {
    return "Embedding model: not suitable for browser agent tasks."
  }

  const sizeInBillions = getModelParameterSizeBillions(model)
  if (sizeInBillions !== null && sizeInBillions < 7) {
    return `Small model (${sizeInBillions}B): browser agent reliability may be poor.`
  }

  const name = model.name.toLowerCase()
  if (
    name.includes("1.5b") ||
    name.includes("1b") ||
    name.includes("2b") ||
    name.includes("3b") ||
    name.includes("mini")
  ) {
    return "This model may be too weak for reliable browser automation."
  }

  return null
}

export const isVisionCapableModel = (
  model: Pick<ProviderModel, "name" | "details">
): boolean => {
  const name = model.name.toLowerCase()
  if (
    name.includes("llava") ||
    name.includes("qwen2.5-vl") ||
    name.includes("qwen2-vl") ||
    name.includes("qwen3-vl") ||
    name.includes("vision") ||
    name.includes("minicpm-v") ||
    name.includes("pixtral")
  ) {
    return true
  }

  return (model.details?.families || []).some((family) =>
    family.toLowerCase().includes("clip")
  )
}

export type ModelSuitability = {
  embeddingOnly: boolean
  weakForAgent: boolean
  weakForVision: boolean
  lacksVisionSupport: boolean
  summary: string | null
}

export const getModelSuitability = (
  model: Pick<ProviderModel, "name" | "details">
): ModelSuitability => {
  const families = model.details?.families || []
  const embeddingOnly = isEmbeddingModel(model.name, families)
  const sizeInBillions = getModelParameterSizeBillions(model)
  const weakBySize = sizeInBillions !== null && sizeInBillions < 7
  const weakByName =
    /(?:^|[\s:_-])(mini|1\.5b|1b|2b|3b)(?:$|[\s:_-])/i.test(model.name)
  const weakForAgent = !embeddingOnly && (weakBySize || weakByName)
  const visionCapable = isVisionCapableModel(model)
  const lacksVisionSupport = !embeddingOnly && !visionCapable
  const weakForVision = !embeddingOnly && (lacksVisionSupport || weakForAgent)

  if (embeddingOnly) {
    return {
      embeddingOnly,
      weakForAgent: true,
      weakForVision: true,
      lacksVisionSupport: true,
      summary: "Embedding only: not suitable for chat, Agent Mode, or Vision Mode."
    }
  }

  const warnings: string[] = []
  if (weakForAgent) {
    warnings.push("Too weak for reliable Agent Mode")
  }
  if (lacksVisionSupport) {
    warnings.push("No Vision Mode support")
  } else if (weakForVision) {
    warnings.push("Vision Mode likely unreliable")
  }

  return {
    embeddingOnly,
    weakForAgent,
    weakForVision,
    lacksVisionSupport,
    summary: warnings.length > 0 ? warnings.join(". ") + "." : null
  }
}
