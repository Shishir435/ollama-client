import type {
  ContextSelection,
  RetrievalPolicy
} from "@ollama-client/contracts/context"
import { browser } from "@/lib/browser-api"
import { vectorDb } from "@/lib/embeddings/db"
import { messageRevision } from "@/lib/embeddings/message-revisions"
import { createAppError } from "@/lib/error-utils"
import { getContextReceiptForMessage } from "@/lib/repositories/turn-runs"
import { readTabContent } from "@/lib/tools/internal/tab-utils"
import type { BuildRagContextOptions } from "./build-context"
import { currentRetrievalPolicy } from "./retrieval-policy"

const pageRevision = (content: string, url: string) =>
  messageRevision({ content, role: url })

/** Keep only hashed page identity and file ids beside the source receipt. */
export const captureContextSelection = async (
  options: BuildRagContextOptions,
  policy: RetrievalPolicy
): Promise<ContextSelection> => {
  const tabs: ContextSelection["tabs"] = []
  if (options.hasTabContext)
    for (const doc of options.tabDocuments) {
      options.signal?.throwIfAborted()
      const tabId = Number(doc.id)
      const tab =
        Number.isInteger(tabId) && browser.tabs?.get
          ? await Promise.resolve(browser.tabs.get(tabId)).catch(
              () => undefined
            )
          : undefined
      tabs.push({
        id: doc.id,
        title: doc.title,
        revision: await pageRevision(doc.content, tab?.url ?? "")
      })
    }
  return {
    policy,
    hasTabContext: options.hasTabContext,
    tabs,
    maxTabContextChars: options.maxTabContextChars,
    maxRagContextChars: options.maxRagContextChars
  }
}

const unavailable = (): never => {
  throw createAppError(
    "The original sources are unavailable or have changed. Would you like to send a new message using the current context?",
    {
      kind: "validation",
      code: "OLC-RESOURCE-NOT-FOUND",
      messageKey: "chat.errors.replay_context_unavailable",
      userMessage:
        "The original sources are unavailable or have changed. Would you like to send a new message using the current context?"
    }
  )
}

/** Restore the recorded scope from canonical rows, or ask before changing evidence. */
export const restoreReplayContext = async (
  options: BuildRagContextOptions
): Promise<BuildRagContextOptions> => {
  if (options.replayOfUserMessageId === undefined) return options
  options.signal?.throwIfAborted()
  const receipt = await getContextReceiptForMessage(
    options.replayOfUserMessageId
  )
  const selection = receipt?.selection
  if (!selection) return unavailable()
  const policy = await currentRetrievalPolicy(selection.policy, options.signal)
  if (
    !policy ||
    (selection.policy.memoryEnabled && !policy.memoryEnabled) ||
    (selection.policy.ragEnabled && !policy.ragEnabled) ||
    policy.fileIds.length !== selection.policy.fileIds.length
  )
    return unavailable()
  const tabDocuments: BuildRagContextOptions["tabDocuments"] = []
  for (const page of selection.tabs) {
    options.signal?.throwIfAborted()
    const tabId = Number(page.id)
    if (!Number.isInteger(tabId)) return unavailable()
    try {
      const tab = await browser.tabs.get(tabId)
      const result = await readTabContent(tabId, { force: true })
      options.signal?.throwIfAborted()
      if (
        result.success === false ||
        !result.html ||
        (await pageRevision(result.html, tab.url ?? "")) !== page.revision
      )
        return unavailable()
      tabDocuments.push({
        id: page.id,
        title: page.title,
        content: result.html
      })
    } catch {
      options.signal?.throwIfAborted()
      return unavailable()
    }
  }
  if (selection.hasTabContext && !tabDocuments.length) return unavailable()
  const files = []
  for (const fileId of policy.fileIds) {
    options.signal?.throwIfAborted()
    const chunks = await vectorDb.vectors
      .where("metadata.fileId")
      .equals(fileId)
      .sortBy("metadata.chunkIndex")
    if (!chunks.length) return unavailable()
    for (const source of receipt!.sources.filter(
      (source) => source.fileId === fileId && typeof source.id === "number"
    )) {
      if (
        !chunks.some(
          (chunk) =>
            chunk.id === source.id && chunk.content.startsWith(source.excerpt)
        )
      )
        return unavailable()
    }
    files.push({
      text: chunks.map((chunk) => chunk.content).join("\n\n"),
      metadata: { fileId, fileName: chunks[0].metadata.title ?? fileId }
    })
  }
  return {
    ...options,
    files,
    hasTabContext: selection.hasTabContext,
    tabDocuments,
    contextText: tabDocuments.map((doc) => doc.content).join("\n\n---\n\n"),
    groundedOnlyMode: policy.groundedOnlyMode,
    memoryEnabled: policy.memoryEnabled,
    maxTabContextChars: selection.maxTabContextChars,
    maxRagContextChars: selection.maxRagContextChars,
    retrievalPolicy: policy
  }
}
