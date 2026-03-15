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
