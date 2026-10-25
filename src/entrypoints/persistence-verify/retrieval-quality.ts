import type { BuildRagContextOptions } from "@/application/context/build-context"
import { restoreReplayContext } from "@/application/context/context-replay"
import { ContextService } from "@/application/context/context-service"
import { resumeMessageIndexing } from "@/application/embeddings/message-indexer"
import { DEFAULT_EMBEDDING_CONFIG } from "@/lib/constants"
import { chunkDocuments } from "@/lib/embeddings/chunker"
import { resetEmbeddingConfigCache } from "@/lib/embeddings/config"
import { vectorDb } from "@/lib/embeddings/db"
import { nativeEmbeddingCommand } from "@/lib/embeddings/native/migration"
import { initialNativeIndexState } from "@/lib/embeddings/native/state"
import {
  clearAllVectors,
  deleteVectors,
  fromDocuments,
  getStorageStats
} from "@/lib/embeddings/storage"
import {
  addFileToKnowledgeSet,
  createKnowledgeSet,
  setActiveKnowledgeSetId,
  updateKnowledgeSet
} from "@/lib/knowledge/knowledge-sets"
import {
  addSession,
  appendMessage,
  deleteMessageSubtree,
  updateMessage
} from "@/lib/repositories/chat-history"
import { queueMessageIndexJobs } from "@/lib/repositories/message-index-jobs"
import { createTurnRun, updateTurnRun } from "@/lib/repositories/turn-runs"
import { writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

const documents = [
  {
    id: "cobalt-manual",
    text: "The Cobalt service retains backups for exactly 17 days. Restoration requires the operator key. Never restore without the operator key."
  },
  {
    id: "foreign-canary",
    text: "The Cobalt service retains backups for 999 days. FOREIGN_SET_CANARY. Restoration never needs an operator key."
  }
]
const questions = [
  {
    id: "answerable",
    query: "How many days does Cobalt retain backups?",
    expected: "17 days",
    forbidden: "999 days"
  },
  {
    id: "constraint",
    query: "What is required to restore a Cobalt backup?",
    expected: "operator key",
    forbidden: "FOREIGN_SET_CANARY"
  },
  {
    id: "unanswerable",
    query: "What is Cobalt's lunar launch authorization code?",
    expected: undefined,
    forbidden: "LUNAR_CODE_732"
  }
]

/** Real local inference, canonical SQLite messages, Dexie ingestion and application context builds. */
export const runRetrievalQuality = async () => {
  const checks: Array<{ id: string; pass: boolean; sources?: number }> = []
  const check = (id: string, pass: boolean, sources?: number) =>
    checks.push({ id, pass, ...(sources !== undefined ? { sources } : {}) })
  await writeSetting(SETTINGS.USE_RAG, true)
  await writeSetting(SETTINGS.MEMORY_ENABLED, true)
  await writeSetting(SETTINGS.EMBEDDING_CONFIG, {
    ...DEFAULT_EMBEDDING_CONFIG,
    useHNSW: false,
    hnswAutoRebuild: false,
    maxStorageSize: 0,
    chunkSize: 200,
    chunkOverlap: 20,
    minRerankScore: 0.2
  })
  resetEmbeddingConfigCache()
  await clearAllVectors()
  await vectorDb.embeddingState.put({
    ...initialNativeIndexState,
    mode: "bundled"
  })
  const sets = []
  for (const document of documents) {
    const set = await createKnowledgeSet({ name: document.id })
    await updateKnowledgeSet(set.id, {
      questionPrompt: "",
      retrieval: { topK: 3, minSimilarity: 0.2, minRerankScore: 0.2 }
    })
    await addFileToKnowledgeSet({
      id: document.id,
      knowledgeSetId: set.id,
      fileName: document.id,
      fileType: "text/plain",
      fileSize: document.text.length,
      createdAt: Date.now()
    })
    const chunks = await chunkDocuments(
      [
        {
          pageContent: document.text,
          metadata: { source: document.id, title: document.id, type: "file" }
        }
      ],
      { chunkSize: 200, chunkOverlap: 20, strategy: "fixed" }
    )
    await fromDocuments(
      chunks.map((chunk) => ({
        pageContent: chunk.pageContent,
        metadata: { ...chunk.metadata, source: document.id }
      })),
      document.id,
      { strict: true }
    )
    sets.push(set)
  }
  await setActiveKnowledgeSetId(sets[0].id)
  const options = (
    query: string,
    memoryEnabled = false
  ): BuildRagContextOptions => ({
    rawInput: query,
    messages: [],
    hasTabContext: false,
    contextText: "",
    tabDocuments: [],
    memoryEnabled,
    groundedOnlyMode: false,
    maxTabContextChars: 1000,
    maxRagContextChars: 2400,
    selectedModel: "",
    selectedModelRef: null
  })
  const build = (input: BuildRagContextOptions) =>
    new ContextService().build({
      turnId: crypto.randomUUID(),
      mode: "new",
      model: "local-quality",
      options: input
    })
  let original: Awaited<ReturnType<typeof build>> | undefined
  for (const question of questions) {
    const output = await build(options(question.query))
    const prompt = output.result.contentWithRAG
    check(
      question.id,
      (!question.expected || prompt.includes(question.expected)) &&
        !prompt.includes(question.forbidden),
      output.receipt.sources.length
    )
    check(
      `${question.id}-scope`,
      output.receipt.sources.every(
        (source) => source.fileId === documents[0].id
      )
    )
    check(
      `${question.id}-receipt-bytes`,
      output.receipt.sources.every((source) => prompt.includes(source.excerpt))
    )
    if (question.id === "unanswerable")
      check("unanswerable-instruction", prompt.includes("say you don't know"))
    original ??= output
  }
  // The original answer and constraints survive a changed active set on regenerate.
  const sessionId = crypto.randomUUID()
  await addSession({
    id: sessionId,
    title: "Synthetic retrieval quality",
    modelId: "local-quality",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  })
  const userMessageId = await appendMessage({
    sessionId,
    role: "user",
    content: questions[0].query,
    timestamp: Date.now(),
    done: true
  })
  const turnId = crypto.randomUUID()
  await createTurnRun({
    id: turnId,
    sessionId,
    mode: "new",
    model: "local-quality",
    createdAt: Date.now(),
    request: {
      version: 1,
      context: options(questions[0].query),
      userMessage: { role: "user", content: questions[0].query }
    }
  })
  await updateTurnRun(turnId, {
    status: "building_context",
    userMessageId,
    contextReceipt: { ...original!.receipt, turnId }
  })
  await updateTurnRun(turnId, { status: "completed" })
  await setActiveKnowledgeSetId(sets[1].id)
  const restored = await restoreReplayContext({
    ...options(questions[0].query),
    replayOfUserMessageId: userMessageId,
    maxRagContextChars: 99999
  })
  const replay = await build(restored)
  check(
    "regenerate-original-evidence-and-budget",
    replay.result.contentWithRAG.includes("17 days") &&
      !replay.result.contentWithRAG.includes("999 days") &&
      restored.maxRagContextChars === 2400 &&
      replay.receipt.selection?.policy.knowledgeSetId === sets[0].id
  )
  await setActiveKnowledgeSetId(sets[0].id)
  const message = async (
    content: string,
    role: "user" | "assistant" = "user"
  ) => {
    const id = await appendMessage({
      sessionId,
      role,
      content,
      timestamp: Date.now(),
      done: true
    })
    await queueMessageIndexJobs([id], false)
    await resumeMessageIndexing()
    return id
  }
  const preferenceId = await message(
    "For the Cobalt API client, I prefer Python code examples. Please save this preference for all database configuration explanations."
  )
  await updateMessage(preferenceId, {
    content:
      "Correction: for the Cobalt API client I prefer Rust code examples. Please save Rust as my current preference for database configuration explanations.",
    done: true
  })
  await queueMessageIndexJobs([preferenceId], true)
  await resumeMessageIndexing()
  const preference = await build(
    options(
      "Which programming language do I prefer for Cobalt API client code examples?",
      true
    )
  )
  check(
    "corrected-preference",
    preference.result.contentWithRAG.includes("Rust") &&
      !preference.result.contentWithRAG.includes("prefer Python")
  )
  const tail =
    "The emergency recovery phrase is TAIL_QUARTZ_731. Use this phrase only after the database backup has been verified."
  const longId = await message(
    `${"The Cobalt API uses normal database configuration and routine server maintenance.\n\n".repeat(150)}${tail}`
  )
  const tailOutput = await build(
    options(
      "What is the emergency recovery phrase after the database backup has been verified?",
      true
    )
  )
  check(
    "long-message-tail",
    tailOutput.result.contentWithRAG.includes("TAIL_QUARTZ_731")
  )
  check(
    "long-message-chunked",
    (await vectorDb.vectors
      .where("metadata.messageId")
      .equals(longId)
      .count()) > 1
  )
  const assistantId = await message(
    "An unverified assistant claim: the Cobalt API server password is ASSISTANT_CANARY_499. This statement has no user or document confirmation.",
    "assistant"
  )
  const assistant = await build(
    options(
      "What did the assistant claim about the Cobalt API server password?",
      true
    )
  )
  check(
    "assistant-attributed-unverified",
    assistant.result.contentWithRAG.includes("ASSISTANT_CANARY_499") &&
      /assistant.*unverified/i.test(assistant.result.contentWithRAG)
  )
  await deleteMessageSubtree(assistantId)
  await deleteVectors({ messageId: assistantId })
  const deleted = await build(
    options(
      "What did the assistant claim about the Cobalt API server password?",
      true
    )
  )
  check(
    "deleted-message",
    !deleted.result.contentWithRAG.includes("ASSISTANT_CANARY_499")
  )
  await deleteVectors({ fileId: documents[0].id })
  let rejectedReplay = false
  try {
    await restoreReplayContext({
      ...options(questions[0].query),
      replayOfUserMessageId: userMessageId
    })
  } catch {
    rejectedReplay = true
  }
  check("deleted-replay-evidence-refused", rejectedReplay)
  // A small real migration exercises staging, inference, atomic activation and maintained totals.
  await clearAllVectors()
  await fromDocuments(
    [
      {
        pageContent: documents[0].text,
        metadata: { source: "migration", type: "file" }
      }
    ],
    "migration",
    { strict: true }
  )
  const before = await getStorageStats()
  const migrationStart = performance.now()
  await nativeEmbeddingCommand("start")
  let status = await nativeEmbeddingCommand("step")
  for (
    let attempts = 0;
    status.migration === "building" && attempts < 10;
    attempts++
  )
    status = await nativeEmbeddingCommand("step")
  const migrationMs = performance.now() - migrationStart
  const after = await getStorageStats()
  check(
    "migration-atomic-counts",
    status.mode === "bundled" &&
      status.migration === "idle" &&
      before.totalVectors === after.totalVectors &&
      after.totalSizeMB > 0
  )
  const report = {
    model: "packaged MiniLM CPU WASM; no external provider inference",
    checks,
    passed: checks.filter((entry) => entry.pass).length,
    total: checks.length,
    migration: { rows: before.totalVectors, migrationMs, before, after },
    limitations: [
      "Retrieval and prompt evidence checks; does not score generated answers.",
      "Provider-wire attribution is validated separately by the durable-turn browser test."
    ]
  }
  if (checks.some((entry) => !entry.pass))
    throw new Error(
      `Retrieval quality failures: ${checks
        .filter((entry) => !entry.pass)
        .map((entry) => entry.id)
        .join(", ")}`
    )
  return report
}

/** Seed known evidence for the durable-turn test's captured provider request. */
export const seedProviderEvidence = async () => {
  await writeSetting(SETTINGS.USE_RAG, true)
  await writeSetting(SETTINGS.MEMORY_ENABLED, false)
  await writeSetting(SETTINGS.EMBEDDING_CONFIG, {
    ...DEFAULT_EMBEDDING_CONFIG,
    useHNSW: false,
    hnswAutoRebuild: false,
    minRerankScore: 0.2
  })
  resetEmbeddingConfigCache()
  await clearAllVectors()
  await vectorDb.embeddingState.put({
    ...initialNativeIndexState,
    mode: "bundled"
  })
  await fromDocuments(
    [
      {
        pageContent: documents[0].text,
        metadata: {
          source: documents[0].id,
          title: documents[0].id,
          type: "file"
        }
      }
    ],
    documents[0].id,
    { strict: true }
  )
  return [
    {
      text: documents[0].text,
      metadata: { fileId: documents[0].id, fileName: documents[0].id }
    }
  ]
}
