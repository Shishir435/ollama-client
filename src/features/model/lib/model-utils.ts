import {
  Bot,
  Brain,
  Code,
  type LucideIcon,
  Settings,
  Sparkles,
  Zap
} from "lucide-react"

const MODEL_ICON_FAMILIES: ReadonlyArray<readonly [string, LucideIcon]> = [
  ["codellama", Code],
  ["starcoder", Code],
  ["qwen", Sparkles],
  ["qwq", Sparkles],
  ["gemma", Sparkles],
  ["mistral", Zap],
  ["mixtral", Zap],
  ["phi", Settings],
  ["deepseek", Brain],
  ["llama", Bot]
]

/**
 * Picks a family icon by matching name *tokens*, not raw substrings.
 *
 * Substring matching mis-assigned real models. "dolphin-llama3" contains "phi",
 * so a `phi` pattern claimed it; only the accident that `llama` happened to be
 * tested first kept it on the llama icon, and reordering the list for any other
 * reason silently broke it. "codellama" contains "llama" the same way, which made
 * the `Code` branch unreachable no matter what it was ordered against.
 *
 * A pattern matches when some token *starts with* it — "phi4" matches `phi`,
 * "dolphin" does not, and "codellama" does not match `llama`. That removes the
 * dependence on ordering; the list stays specific-first only for readability.
 */
export const getModelIcon = (modelName: string): LucideIcon => {
  // Checked first: an embedding model's name usually carries a family too
  // ("mxbai-embed-large", "qwen3-embedding"), and what it is matters more than
  // who made it.
  if (isEmbeddingModel(modelName)) return Brain

  const tokens = modelName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  for (const [family, icon] of MODEL_ICON_FAMILIES) {
    if (tokens.some((token) => token.startsWith(family))) return icon
  }
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
