import type { EmbeddingConfig } from "@/lib/constants"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/**
 * Gets embedding configuration
 */
export const getEmbeddingConfig = async (): Promise<EmbeddingConfig> => {
  return readSetting(SETTINGS.EMBEDDING_CONFIG)
}
