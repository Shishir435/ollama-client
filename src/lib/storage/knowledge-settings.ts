import { z } from "zod"
import { STORAGE_KEYS } from "@/lib/constants"
import { defineSetting } from "./setting-descriptor"

export const KNOWLEDGE_DEFAULTS = {
  chunkSize: 1000,
  chunkOverlap: 200,
  splittingStrategy: "recursive" as "recursive" | "character",
  characterSeparator: "\\n\\n",
  retrievalTopK: 4,
  maxContextSize: 20000,
  systemPrompt: `You are a helpful AI assistant. Answer the question using ONLY the context in <doc> and <memory> blocks. If the answer is not in the context, say you don't know. Do not make up an answer.

Each <doc> has attributes: id, source, page (if available), chunk (if available), score.
<memory> blocks contain relevant conversation history or user-specific context.
When you use information from a doc, cite it using [doc:id] or [doc:id p:page]. If multiple docs are used, cite each.

Context:
{context}

Question: {question}
Answer:`,
  questionPrompt: `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question.

Chat History: {chat_history}
Follow Up Input: {question}
Standalone question:`
} as const

const positiveInteger = z.number().int().positive().finite()
const nonNegativeInteger = z.number().int().nonnegative().finite()

export const KNOWLEDGE_SETTINGS = {
  ACTIVE_SET: defineSetting(STORAGE_KEYS.KNOWLEDGE.ACTIVE_SET, {
    defaultValue: "default",
    parser: z.string().min(1)
  }),
  CHUNK_SIZE: defineSetting(STORAGE_KEYS.KNOWLEDGE.CHUNK_SIZE, {
    defaultValue: KNOWLEDGE_DEFAULTS.chunkSize,
    parser: positiveInteger
  }),
  CHUNK_OVERLAP: defineSetting(STORAGE_KEYS.KNOWLEDGE.CHUNK_OVERLAP, {
    defaultValue: KNOWLEDGE_DEFAULTS.chunkOverlap,
    parser: nonNegativeInteger
  }),
  SPLITTING_STRATEGY: defineSetting(STORAGE_KEYS.KNOWLEDGE.SPLITTING_STRATEGY, {
    defaultValue: KNOWLEDGE_DEFAULTS.splittingStrategy,
    parser: z.enum(["recursive", "character"])
  }),
  CHARACTER_SEPARATOR: defineSetting(
    STORAGE_KEYS.KNOWLEDGE.CHARACTER_SEPARATOR,
    {
      defaultValue: KNOWLEDGE_DEFAULTS.characterSeparator,
      parser: z.string()
    }
  ),
  RETRIEVAL_TOP_K: defineSetting(STORAGE_KEYS.KNOWLEDGE.RETRIEVAL_TOP_K, {
    defaultValue: KNOWLEDGE_DEFAULTS.retrievalTopK,
    parser: positiveInteger
  }),
  EMBEDDING_MODEL: defineSetting<string | null>(
    STORAGE_KEYS.KNOWLEDGE.EMBEDDING_MODEL,
    { defaultValue: null, parser: z.string().min(1).nullable() }
  ),
  SYSTEM_PROMPT: defineSetting(STORAGE_KEYS.KNOWLEDGE.SYSTEM_PROMPT, {
    defaultValue: KNOWLEDGE_DEFAULTS.systemPrompt,
    parser: z.string()
  }),
  QUESTION_PROMPT: defineSetting(STORAGE_KEYS.KNOWLEDGE.QUESTION_PROMPT, {
    defaultValue: KNOWLEDGE_DEFAULTS.questionPrompt,
    parser: z.string()
  }),
  MAX_CONTEXT_SIZE: defineSetting(STORAGE_KEYS.KNOWLEDGE.MAX_CONTEXT_SIZE, {
    defaultValue: KNOWLEDGE_DEFAULTS.maxContextSize,
    parser: positiveInteger
  })
} as const
