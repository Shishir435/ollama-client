import Dexie, { type Table } from "dexie"
import { KNOWLEDGE_DEFAULTS } from "@/lib/config/knowledge-config"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export interface KnowledgeSetRecord {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  ragPrompt?: string
  questionPrompt?: string
  retrieval?: {
    topK?: number
    minSimilarity?: number
    minRerankScore?: number
  }
}

export interface KnowledgeFileRecord {
  id: string
  knowledgeSetId: string
  fileName: string
  fileType: string
  fileSize: number
  createdAt: number
  lastEmbeddedAt?: number
}

class KnowledgeDatabase extends Dexie {
  knowledgeSets!: Table<KnowledgeSetRecord, string>
  knowledgeFiles!: Table<KnowledgeFileRecord, string>

  constructor() {
    super("KnowledgeDatabase")
    this.version(1).stores({
      knowledgeSets: "id, name, updatedAt",
      knowledgeFiles: "id, knowledgeSetId, fileName, createdAt"
    })
  }
}

export const knowledgeDb = new KnowledgeDatabase()

export const DEFAULT_KNOWLEDGE_SET_ID = "default"
export const DEFAULT_KNOWLEDGE_SET_NAME = "Default"
export const DEFAULT_RAG_PROMPT =
  "Use ONLY the following context in <doc> blocks. If the answer is not in the context, say you don't know."
export const DEFAULT_QUESTION_PROMPT = KNOWLEDGE_DEFAULTS.questionPrompt

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `ks-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

export const ensureDefaultKnowledgeSet =
  async (): Promise<KnowledgeSetRecord> => {
    const existing = await knowledgeDb.knowledgeSets.get(
      DEFAULT_KNOWLEDGE_SET_ID
    )
    if (existing) return existing

    const now = Date.now()
    const record: KnowledgeSetRecord = {
      id: DEFAULT_KNOWLEDGE_SET_ID,
      name: DEFAULT_KNOWLEDGE_SET_NAME,
      createdAt: now,
      updatedAt: now,
      ragPrompt: DEFAULT_RAG_PROMPT,
      questionPrompt: DEFAULT_QUESTION_PROMPT
    }
    await knowledgeDb.knowledgeSets.put(record)
    return record
  }

export const listKnowledgeSets = async (): Promise<KnowledgeSetRecord[]> => {
  await ensureDefaultKnowledgeSet()
  return knowledgeDb.knowledgeSets.toArray()
}

export const getKnowledgeSet = async (
  id: string
): Promise<KnowledgeSetRecord | undefined> => {
  return knowledgeDb.knowledgeSets.get(id)
}

export const createKnowledgeSet = async (data: {
  name: string
  description?: string
}): Promise<KnowledgeSetRecord> => {
  const now = Date.now()
  const record: KnowledgeSetRecord = {
    id: createId(),
    name: data.name,
    description: data.description,
    createdAt: now,
    updatedAt: now,
    ragPrompt: DEFAULT_RAG_PROMPT,
    questionPrompt: DEFAULT_QUESTION_PROMPT
  }
  await knowledgeDb.knowledgeSets.put(record)
  return record
}

export const updateKnowledgeSet = async (
  id: string,
  updates: Partial<KnowledgeSetRecord>
): Promise<void> => {
  const existing = await knowledgeDb.knowledgeSets.get(id)
  if (!existing) return
  await knowledgeDb.knowledgeSets.put({
    ...existing,
    ...updates,
    updatedAt: Date.now()
  })
}

export const deleteKnowledgeSet = async (id: string): Promise<void> => {
  if (id === DEFAULT_KNOWLEDGE_SET_ID) return
  await knowledgeDb.knowledgeSets.delete(id)
  await knowledgeDb.knowledgeFiles.where("knowledgeSetId").equals(id).delete()
  const active = await getActiveKnowledgeSetId()
  if (active === id) {
    await setActiveKnowledgeSetId(DEFAULT_KNOWLEDGE_SET_ID)
  }
}

export const addFileToKnowledgeSet = async (
  file: KnowledgeFileRecord
): Promise<void> => {
  await knowledgeDb.knowledgeFiles.put(file)
}

export const markKnowledgeFileEmbedded = async (
  fileId: string,
  embeddedAt: number = Date.now()
): Promise<void> => {
  const existing = await knowledgeDb.knowledgeFiles.get(fileId)
  if (!existing) return
  await knowledgeDb.knowledgeFiles.put({
    ...existing,
    lastEmbeddedAt: embeddedAt
  })
}

export const getKnowledgeSetFileIds = async (
  knowledgeSetId: string
): Promise<string[]> => {
  const files = await knowledgeDb.knowledgeFiles
    .where("knowledgeSetId")
    .equals(knowledgeSetId)
    .toArray()
  return files.map((file) => file.id)
}

export const getActiveKnowledgeSetId = async (): Promise<string> => {
  const stored = await plasmoGlobalStorage.get<string>(
    STORAGE_KEYS.KNOWLEDGE.ACTIVE_SET
  )

  if (stored) return stored

  await ensureDefaultKnowledgeSet()
  await plasmoGlobalStorage.set(
    STORAGE_KEYS.KNOWLEDGE.ACTIVE_SET,
    DEFAULT_KNOWLEDGE_SET_ID
  )
  return DEFAULT_KNOWLEDGE_SET_ID
}

export const setActiveKnowledgeSetId = async (id: string): Promise<void> => {
  await plasmoGlobalStorage.set(STORAGE_KEYS.KNOWLEDGE.ACTIVE_SET, id)
}

export const getActiveKnowledgeSet = async (): Promise<
  KnowledgeSetRecord | undefined
> => {
  const id = await getActiveKnowledgeSetId()
  return getKnowledgeSet(id)
}
