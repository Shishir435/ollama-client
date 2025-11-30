import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { CharacterTextSplitter } from "../text-processing/character-text-splitter"
import { RecursiveCharacterTextSplitter } from "../text-processing/recursive-character-text-splitter"
import type { TextSplitter } from "../text-processing/types"

export const KNOWLEDGE_CONFIG_KEYS = {
  CHUNK_SIZE: "knowledge.chunkSize",
  CHUNK_OVERLAP: "knowledge.chunkOverlap",
  SPLITTING_STRATEGY: "knowledge.splittingStrategy",
  CHARACTER_SEPARATOR: "knowledge.characterSeparator",
  RETRIEVAL_TOP_K: "knowledge.retrievalTopK",
  EMBEDDING_MODEL: "knowledge.embeddingModel",
  SYSTEM_PROMPT: "knowledge.systemPrompt",
  QUESTION_PROMPT: "knowledge.questionPrompt",
  MAX_CONTEXT_SIZE: "knowledge.maxContextSize"
} as const

export const KNOWLEDGE_DEFAULTS = {
  chunkSize: 1000,
  chunkOverlap: 200,
  splittingStrategy: "recursive" as "recursive" | "character",
  characterSeparator: "\\n\\n",
  retrievalTopK: 4,
  maxContextSize: 10000,
  systemPrompt: `You are a helpful AI assistant. Use the following pieces of context to answer the question at the end. If you don't know the answer, just say you don't know. DO NOT try to make up an answer. If the question is not related to the context, politely respond that you are tuned to only answer questions that are related to the context.

{context}

Question: {question}
Helpful answer:`,
  questionPrompt: `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.

Chat History: {chat_history}
Follow Up Input: {question}
Standalone question:`
} as const

export class KnowledgeConfig {
  async getChunkSize(): Promise<number> {
    const value = await plasmoGlobalStorage.get<number>(
      KNOWLEDGE_CONFIG_KEYS.CHUNK_SIZE
    )
    return value ?? KNOWLEDGE_DEFAULTS.chunkSize
  }

  async setChunkSize(size: number): Promise<void> {
    await plasmoGlobalStorage.set(KNOWLEDGE_CONFIG_KEYS.CHUNK_SIZE, size)
  }

  async getChunkOverlap(): Promise<number> {
    const value = await plasmoGlobalStorage.get<number>(
      KNOWLEDGE_CONFIG_KEYS.CHUNK_OVERLAP
    )
    return value ?? KNOWLEDGE_DEFAULTS.chunkOverlap
  }

  async setChunkOverlap(overlap: number): Promise<void> {
    await plasmoGlobalStorage.set(KNOWLEDGE_CONFIG_KEYS.CHUNK_OVERLAP, overlap)
  }

  async getSplittingStrategy(): Promise<"recursive" | "character"> {
    const value = await plasmoGlobalStorage.get<"recursive" | "character">(
      KNOWLEDGE_CONFIG_KEYS.SPLITTING_STRATEGY
    )
    return value ?? KNOWLEDGE_DEFAULTS.splittingStrategy
  }

  async setSplittingStrategy(
    strategy: "recursive" | "character"
  ): Promise<void> {
    await plasmoGlobalStorage.set(
      KNOWLEDGE_CONFIG_KEYS.SPLITTING_STRATEGY,
      strategy
    )
  }

  async getCharacterSeparator(): Promise<string> {
    const value = await plasmoGlobalStorage.get<string>(
      KNOWLEDGE_CONFIG_KEYS.CHARACTER_SEPARATOR
    )
    return value ?? KNOWLEDGE_DEFAULTS.characterSeparator
  }

  async setCharacterSeparator(separator: string): Promise<void> {
    await plasmoGlobalStorage.set(
      KNOWLEDGE_CONFIG_KEYS.CHARACTER_SEPARATOR,
      separator
    )
  }

  async getRetrievalTopK(): Promise<number> {
    const value = await plasmoGlobalStorage.get<number>(
      KNOWLEDGE_CONFIG_KEYS.RETRIEVAL_TOP_K
    )
    return value ?? KNOWLEDGE_DEFAULTS.retrievalTopK
  }

  async setRetrievalTopK(k: number): Promise<void> {
    await plasmoGlobalStorage.set(KNOWLEDGE_CONFIG_KEYS.RETRIEVAL_TOP_K, k)
  }

  async getEmbeddingModel(): Promise<string | null> {
    const value = await plasmoGlobalStorage.get<string>(
      KNOWLEDGE_CONFIG_KEYS.EMBEDDING_MODEL
    )
    return value ?? null
  }

  async setEmbeddingModel(model: string | null): Promise<void> {
    if (model === null) {
      await plasmoGlobalStorage.remove(KNOWLEDGE_CONFIG_KEYS.EMBEDDING_MODEL)
    } else {
      await plasmoGlobalStorage.set(
        KNOWLEDGE_CONFIG_KEYS.EMBEDDING_MODEL,
        model
      )
    }
  }

  async getSystemPrompt(): Promise<string> {
    const value = await plasmoGlobalStorage.get<string>(
      KNOWLEDGE_CONFIG_KEYS.SYSTEM_PROMPT
    )
    return value ?? KNOWLEDGE_DEFAULTS.systemPrompt
  }

  async setSystemPrompt(prompt: string): Promise<void> {
    await plasmoGlobalStorage.set(KNOWLEDGE_CONFIG_KEYS.SYSTEM_PROMPT, prompt)
  }

  async getQuestionPrompt(): Promise<string> {
    const value = await plasmoGlobalStorage.get<string>(
      KNOWLEDGE_CONFIG_KEYS.QUESTION_PROMPT
    )
    return value ?? KNOWLEDGE_DEFAULTS.questionPrompt
  }

  async setQuestionPrompt(prompt: string): Promise<void> {
    await plasmoGlobalStorage.set(KNOWLEDGE_CONFIG_KEYS.QUESTION_PROMPT, prompt)
  }

  async getMaxContextSize(): Promise<number> {
    const value = await plasmoGlobalStorage.get<number>(
      KNOWLEDGE_CONFIG_KEYS.MAX_CONTEXT_SIZE
    )
    return value ?? KNOWLEDGE_DEFAULTS.maxContextSize
  }

  async setMaxContextSize(size: number): Promise<void> {
    await plasmoGlobalStorage.set(KNOWLEDGE_CONFIG_KEYS.MAX_CONTEXT_SIZE, size)
  }
}

export const knowledgeConfig = new KnowledgeConfig()

/**
 * Get configured text splitter based on user settings
 */
export async function getTextSplitter(): Promise<TextSplitter> {
  const chunkSize = await knowledgeConfig.getChunkSize()
  const chunkOverlap = await knowledgeConfig.getChunkOverlap()
  const strategy = await knowledgeConfig.getSplittingStrategy()

  if (strategy === "character") {
    const rawSeparator = await knowledgeConfig.getCharacterSeparator()
    // Process escape sequences
    const separator = rawSeparator
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")

    return new CharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separator
    })
  }

  // Default: recursive
  return new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap
  })
}
