import { useModelInfo } from "./use-model-info"

/**
 * Heuristics to determine if a selected model supports vision (images).
 */
export const useIsVisionCapable = (
  model: string | undefined,
  providerId?: string
) => {
  const { modelInfo } = useModelInfo(model || "", providerId)

  if (!model) return false

  const mLow = model.toLowerCase()
  if (
    mLow.includes("llava") ||
    mLow.includes("qwen2.5-vl") ||
    mLow.includes("qwen2-vl") ||
    mLow.includes("vision") ||
    mLow.includes("minicpm-v") ||
    mLow.includes("pixtral")
  ) {
    return true
  }

  if (modelInfo?.details?.families?.includes("clip")) {
    return true
  }

  return false
}
