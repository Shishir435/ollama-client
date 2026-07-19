import { resolveModelTools } from "@/background/lib/resolve-model-tools"
import { safePostMessage } from "@/background/lib/utils"
import {
  type BuildRagContextResult,
  buildRagContext
} from "@/features/chat/hooks/build-rag-context"
import { logger } from "@/lib/logger"
import { ProviderFactory } from "@/lib/providers/factory"
import type {
  ActivityEvent,
  BuildContextMessage,
  ChromeMessage,
  ChromePort,
  PortStatusFunction
} from "@/types"

/**
 * Tools that let the model retrieve stored file/conversation context itself.
 * When any is offered this turn, the harness defers to the model instead of
 * pre-injecting that context.
 */
const RETRIEVAL_TOOL_NAMES = new Set(["rag_search", "file_search"])

/**
 * Whether this model+turn will be offered its own retrieval tools. Resolved
 * through the same governance/capability path the chat turn uses. Failures
 * default to false so context is auto-injected (safe fallback).
 */
const resolveRetrievalToolsActive = async (
  modelId: string,
  providerId: string | undefined,
  latestUserText: string
): Promise<boolean> => {
  try {
    const provider = await ProviderFactory.getProviderForModel(
      modelId,
      providerId
    )
    const resolved = await resolveModelTools(
      modelId,
      providerId,
      provider,
      latestUserText
    )
    return Boolean(
      resolved?.tools.some((tool) => RETRIEVAL_TOOL_NAMES.has(tool.name))
    )
  } catch (error) {
    logger.debug(
      "Failed to resolve retrieval tools for context gating; auto-injecting",
      "handleBuildContext",
      { error }
    )
    return false
  }
}

/**
 * Background owner of turn context building. The sidepanel sends the raw query
 * plus selected tabs/files/flags; this runs the RAG/page/memory pipeline here
 * (embeddings and provider fetches happen over the same port that chat
 * streaming uses, so worker fetch reliability matches streaming) and streams
 * progress back live so the UI activity trace updates step by step, exactly
 * like an agentic harness. Exactly one `context_result` (or `context_error`)
 * terminates the exchange.
 */
export const handleBuildContext = async (
  msg: BuildContextMessage,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> => {
  const p = msg.payload
  const post = (message: Record<string, unknown>): void => {
    if (isPortClosed()) return
    safePostMessage(port, message as unknown as ChromeMessage)
  }

  try {
    const modelId =
      p.customModel || p.selectedModelRef?.modelId || p.selectedModel
    const retrievalToolsActive = await resolveRetrievalToolsActive(
      modelId,
      p.selectedModelRef?.providerId,
      p.rawInput
    )

    const result: BuildRagContextResult = await buildRagContext({
      rawInput: p.rawInput,
      files: p.files,
      messages: p.messages,
      hasTabContext: p.hasTabContext,
      contextText: p.contextText,
      tabDocuments: p.tabDocuments,
      memoryEnabled: p.memoryEnabled,
      maxTabContextChars: p.maxTabContextChars,
      maxRagContextChars: p.maxRagContextChars,
      groundedOnlyMode: p.groundedOnlyMode,
      retrievalToolsActive,
      selectedModel: p.selectedModel,
      selectedModelRef: p.selectedModelRef,
      customModel: p.customModel,
      onActivityEvent: (events: ActivityEvent[]) =>
        post({
          type: "context_progress",
          requestId: p.requestId,
          events
        }),
      toast: (warning) =>
        post({
          type: "context_warning",
          requestId: p.requestId,
          payload: warning
        })
    })

    post({ type: "context_result", requestId: p.requestId, result })
  } catch (error) {
    logger.error("Failed to build context", "handleBuildContext", { error })
    post({
      type: "context_error",
      requestId: p.requestId,
      error: error instanceof Error ? error.message : "Context build failed"
    })
  }
}
