import Dexie, { type Table } from "dexie"
import { z } from "zod"
import { KNOWLEDGE_DEFAULTS } from "@/lib/config/knowledge-config"
import { KNOWLEDGE_SETTINGS } from "@/lib/storage/knowledge-settings"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"

const storedTimestamp = z.number().finite().nonnegative()

export const KnowledgeSetRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  createdAt: storedTimestamp,
  updatedAt: storedTimestamp,
  ragPrompt: z.string().optional(),
  questionPrompt: z.string().optional(),
  retrieval: z
    .object({
      topK: z.number().int().positive().optional(),
      minSimilarity: z.number().finite().optional(),
      minRerankScore: z.number().finite().optional()
    })
    .optional()
})

export type KnowledgeSetRecord = z.infer<typeof KnowledgeSetRecordSchema>

export const KnowledgeFileRecordSchema = z.object({
  id: z.string().min(1),
  knowledgeSetId: z.string().min(1),
  fileName: z.string().min(1),
  fileType: z.string(),
  fileSize: z.number().finite().nonnegative(),
  createdAt: storedTimestamp,
  lastEmbeddedAt: storedTimestamp.optional()
})

export type KnowledgeFileRecord = z.infer<typeof KnowledgeFileRecordSchema>

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
  "Use ONLY the following context in <doc> and <memory> blocks. If the answer is not in the context, say you don't know."
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
  await knowledgeDb.knowledgeFiles.put(KnowledgeFileRecordSchema.parse(file))
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

export const removeKnowledgeFile = async (fileId: string): Promise<void> => {
  await knowledgeDb.knowledgeFiles.delete(fileId)
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
  const stored = await readSetting(KNOWLEDGE_SETTINGS.ACTIVE_SET)

  if (stored) return stored

  await ensureDefaultKnowledgeSet()
  await writeSetting(KNOWLEDGE_SETTINGS.ACTIVE_SET, DEFAULT_KNOWLEDGE_SET_ID)
  return DEFAULT_KNOWLEDGE_SET_ID
}

export const setActiveKnowledgeSetId = async (id: string): Promise<void> => {
  await writeSetting(KNOWLEDGE_SETTINGS.ACTIVE_SET, id)
}

export const getActiveKnowledgeSet = async (): Promise<
  KnowledgeSetRecord | undefined
> => {
  const id = await getActiveKnowledgeSetId()
  return getKnowledgeSet(id)
}
