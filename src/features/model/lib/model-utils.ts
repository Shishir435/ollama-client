import {
  Bot,
  Brain,
  Code,
  type LucideIcon,
  Settings,
  Sparkles,
  Zap
} from "lucide-react"

export const getModelIcon = (modelName: string): LucideIcon => {
  const name = modelName.toLowerCase()
  if (name.includes("llama")) return Bot
  if (name.includes("mistral")) return Zap
  if (name.includes("codellama")) return Code
  if (name.includes("phi")) return Settings
  if (name.includes("gemma")) return Sparkles
  if (name.includes("qwq")) return Sparkles
  if (isEmbeddingModel(modelName)) return Brain
  return Bot
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
  return families.some((f) => embeddingFamilies.includes(f.toLowerCase()))
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

const PARAMETER_UNITS = [
  { suffix: "T", multiplier: 1e12 },
  { suffix: "B", multiplier: 1e9 },
  { suffix: "M", multiplier: 1e6 },
  { suffix: "K", multiplier: 1e3 }
] as const

const roundToTenth = (value: number) => Math.round(value * 10) / 10

/**
 * Normalizes the provider-supplied parameter-size string so a model list does
 * not mix "8B", "8.2B", and "999.89M". Providers report whatever their metadata
 * holds: Ollama passes its own string through, llama.cpp derives one from
 * `n_params`, and others leave it empty.
 *
 * At most one decimal, trailing ".0" dropped, and the unit is picked from the
 * *rounded* value so a size that rounds up to the next unit promotes with it
 * ("999.89M" → "1B") instead of reading as a different magnitude than its
 * neighbours. Input that is not a plain number with an optional K/M/B/T suffix
 * is returned trimmed but otherwise untouched.
 */
export const formatParameterSize = (raw: string): string => {
  const trimmed = raw.trim()
  const match = /^(\d+(?:\.\d+)?)\s*([KMBT])?$/i.exec(trimmed)
  if (!match) return trimmed

  const [, value, suffix] = match
  const unitMultiplier = suffix
    ? PARAMETER_UNITS.find((unit) => unit.suffix === suffix.toUpperCase())
        ?.multiplier
    : 1
  if (!unitMultiplier) return trimmed

  const count = Number(value) * unitMultiplier
  if (!Number.isFinite(count) || count <= 0) return trimmed

  const unit = PARAMETER_UNITS.find(
    (candidate) => roundToTenth(count / candidate.multiplier) >= 1
  )
  if (!unit) return `${roundToTenth(count)}`

  const scaled = roundToTenth(count / unit.multiplier)
  return `${scaled.toFixed(1).replace(/\.0$/, "")}${unit.suffix}`
}
