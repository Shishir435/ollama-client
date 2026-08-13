import { isChromiumBased } from "@/lib/browser-api"
import { applyLocalProviderOriginRule } from "@/lib/dnr-rules"
import { logger } from "@/lib/logger"
import { getOllamaBaseUrl } from "./ollama-base-url"

export const updateDNRRules = async (): Promise<void> => {
  if (!isChromiumBased()) {
    logger.warn(
      "DNR not available: Firefox requires local provider origin configuration",
      "DNR"
    )
    return
  }

  try {
    const baseUrl = await getOllamaBaseUrl()
    await applyLocalProviderOriginRule(new URL(baseUrl).origin)
  } catch (error) {
    // Don't throw - allow extension to continue without DNR
    logger.error("Failed to update DNR rules", "DNR", { error })
  }
}
