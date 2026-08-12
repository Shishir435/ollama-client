import { DEFAULT_EMBEDDING_CONFIG } from "@/lib/constants"
import { getEmbeddingConfig } from "@/lib/embeddings/config"
import {
  KNOWLEDGE_DEFAULTS,
  KNOWLEDGE_SETTINGS
} from "@/lib/storage/knowledge-settings"
import {
  readSetting,
  removeSetting,
  writeSetting
} from "@/lib/storage/setting-access"

export { KNOWLEDGE_DEFAULTS }
export const KNOWLEDGE_CONFIG_KEYS = Object.fromEntries(
  Object.entries(KNOWLEDGE_SETTINGS).map(([name, descriptor]) => [
    name,
    descriptor.key
  ])
) as {
  [K in keyof typeof KNOWLEDGE_SETTINGS]: (typeof KNOWLEDGE_SETTINGS)[K]["key"]
}

export class KnowledgeConfig {
  async getChunkSize(): Promise<number> {
    return readSetting(KNOWLEDGE_SETTINGS.CHUNK_SIZE)
  }

  async setChunkSize(size: number): Promise<void> {
    await writeSetting(KNOWLEDGE_SETTINGS.CHUNK_SIZE, size)
  }

  async getChunkOverlap(): Promise<number> {
    return readSetting(KNOWLEDGE_SETTINGS.CHUNK_OVERLAP)
  }

  async setChunkOverlap(overlap: number): Promise<void> {
    await writeSetting(KNOWLEDGE_SETTINGS.CHUNK_OVERLAP, overlap)
  }

  async getSplittingStrategy(): Promise<"recursive" | "character"> {
    return readSetting(KNOWLEDGE_SETTINGS.SPLITTING_STRATEGY)
  }

  async setSplittingStrategy(
    strategy: "recursive" | "character"
  ): Promise<void> {
    await writeSetting(KNOWLEDGE_SETTINGS.SPLITTING_STRATEGY, strategy)
  }

  async getCharacterSeparator(): Promise<string> {
    return readSetting(KNOWLEDGE_SETTINGS.CHARACTER_SEPARATOR)
  }

  async setCharacterSeparator(separator: string): Promise<void> {
    await writeSetting(KNOWLEDGE_SETTINGS.CHARACTER_SEPARATOR, separator)
  }

  async getRetrievalTopK(): Promise<number> {
    return readSetting(KNOWLEDGE_SETTINGS.RETRIEVAL_TOP_K)
  }

  async getMinSimilarity(): Promise<number> {
    const config = await getEmbeddingConfig()
    return (
      config?.defaultMinSimilarity ??
      DEFAULT_EMBEDDING_CONFIG.defaultMinSimilarity
    )
  }

  async setRetrievalTopK(k: number): Promise<void> {
    await writeSetting(KNOWLEDGE_SETTINGS.RETRIEVAL_TOP_K, k)
  }

  async getEmbeddingModel(): Promise<string | null> {
    return readSetting(KNOWLEDGE_SETTINGS.EMBEDDING_MODEL)
  }

  async setEmbeddingModel(model: string | null): Promise<void> {
    if (model === null) {
      await removeSetting(KNOWLEDGE_SETTINGS.EMBEDDING_MODEL)
    } else {
      await writeSetting(KNOWLEDGE_SETTINGS.EMBEDDING_MODEL, model)
    }
  }

  async getSystemPrompt(): Promise<string> {
    return readSetting(KNOWLEDGE_SETTINGS.SYSTEM_PROMPT)
  }

  async setSystemPrompt(prompt: string): Promise<void> {
    await writeSetting(KNOWLEDGE_SETTINGS.SYSTEM_PROMPT, prompt)
  }

  async getQuestionPrompt(): Promise<string> {
    return readSetting(KNOWLEDGE_SETTINGS.QUESTION_PROMPT)
  }

  async setQuestionPrompt(prompt: string): Promise<void> {
    await writeSetting(KNOWLEDGE_SETTINGS.QUESTION_PROMPT, prompt)
  }

  async getMaxContextSize(): Promise<number> {
    return readSetting(KNOWLEDGE_SETTINGS.MAX_CONTEXT_SIZE)
  }

  async setMaxContextSize(size: number): Promise<void> {
    await writeSetting(KNOWLEDGE_SETTINGS.MAX_CONTEXT_SIZE, size)
  }
}

export const knowledgeConfig = new KnowledgeConfig()
