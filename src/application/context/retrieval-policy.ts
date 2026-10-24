import type {
  ContextFileInput,
  RetrievalPolicy
} from "@ollama-client/contracts/context"
import {
  getActiveKnowledgeSet,
  getKnowledgeSetFileIds
} from "@/lib/knowledge/knowledge-sets"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/** Resolve scope once in the background; an empty selection never means all files. */
export const resolveRetrievalPolicy = async (input: {
  memoryEnabled: boolean
  groundedOnlyMode: boolean
  files?: ContextFileInput[]
  signal?: AbortSignal
}): Promise<RetrievalPolicy> => {
  input.signal?.throwIfAborted()
  const ragEnabled = await readSetting(SETTINGS.USE_RAG)
  const memoryEnabled =
    input.memoryEnabled && (await readSetting(SETTINGS.MEMORY_ENABLED))
  const set =
    input.files?.length || !ragEnabled
      ? undefined
      : await getActiveKnowledgeSet()
  const knowledgeSetId = input.files?.length ? undefined : set?.id
  const fileIds = input.files?.length
    ? input.files.flatMap((file) =>
        file.metadata.fileId ? [file.metadata.fileId] : []
      )
    : knowledgeSetId
      ? await getKnowledgeSetFileIds(knowledgeSetId)
      : []
  input.signal?.throwIfAborted()
  return {
    memoryEnabled,
    ragEnabled,
    groundedOnlyMode: input.groundedOnlyMode,
    fileIds: [...new Set(fileIds)],
    ...(knowledgeSetId ? { knowledgeSetId } : {})
  }
}

/** Re-check opt-outs and set membership at execution; later settings cannot widen scope. */
export const currentRetrievalPolicy = async (
  policy: RetrievalPolicy | undefined,
  signal?: AbortSignal
): Promise<RetrievalPolicy | undefined> => {
  signal?.throwIfAborted()
  if (!policy) return undefined
  const ragEnabled = policy.ragEnabled && (await readSetting(SETTINGS.USE_RAG))
  const memoryEnabled =
    policy.memoryEnabled && (await readSetting(SETTINGS.MEMORY_ENABLED))
  const members = policy.knowledgeSetId
    ? new Set(await getKnowledgeSetFileIds(policy.knowledgeSetId))
    : undefined
  signal?.throwIfAborted()
  return {
    ...policy,
    ragEnabled,
    memoryEnabled,
    fileIds: members
      ? policy.fileIds.filter((id) => members.has(id))
      : policy.fileIds
  }
}

export const retrievalToolAllowed = (
  name: string,
  policy?: RetrievalPolicy
): boolean => {
  if (name !== "rag_search" && name !== "file_search") return true
  if (!policy?.ragEnabled || policy.groundedOnlyMode) return false
  return name === "rag_search"
    ? policy.memoryEnabled
    : policy.fileIds.length > 0
}
