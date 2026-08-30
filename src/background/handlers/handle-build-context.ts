import { ContextService } from "@/application/context/context-service"
import {
  clearAbortController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import { resolveModelTools } from "@/background/lib/resolve-model-tools"
import { hasRetrievalTool } from "@/background/lib/retrieval-tools"
import { safePostChatStreamEvent } from "@/background/lib/runtime-delivery"
import { logger } from "@/lib/logger"
import { ProviderFactory } from "@/lib/providers/factory"
import { toAppFailure } from "@/protocol/app-failure"
import {
  CHAT_STREAM_EVENT_TYPES,
  type ChatStreamServerEvent
} from "@/protocol/streams"
import type {
  ActivityEvent,
  BuildContextMessage,
  ChromePort,
  PortStatusFunction
} from "@/types"

/**
 * Whether this model+turn will be offered its own retrieval tools. Resolved
 * through the same governance/capability path the chat turn uses. Failures
 * default to false so context is auto-injected (safe fallback).
 */
export const resolveRetrievalToolsActive = async (
  modelId: string,
  providerId: string | undefined,
  latestUserText: string,
  signal?: AbortSignal
): Promise<boolean> => {
  try {
    signal?.throwIfAborted()
    const provider = await ProviderFactory.getProviderForModel(
      modelId,
      providerId
    )
    const resolved = await resolveModelTools(
      modelId,
      providerId,
      provider,
      latestUserText,
      undefined,
      signal
    )
    return hasRetrievalTool(resolved)
  } catch (error) {
    if (signal?.aborted) throw error
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
  const post = (message: ChatStreamServerEvent): void => {
    if (isPortClosed()) return
    safePostChatStreamEvent(port, message)
  }

  // Unlike a durable turn, this build has no owner once the panel goes away —
  // its result can only be delivered over this port. Registering under the
  // request id puts it on the same abort path as a chat stream, so both a stop
  // and a disconnect end the retrieval and embedding work instead of leaving it
  // running for a reply nobody can receive.
  const controller = new AbortController()
  setAbortController(p.requestId, controller)

  try {
    const modelId =
      p.customModel || p.selectedModelRef?.modelId || p.selectedModel
    const retrievalToolsActive = await resolveRetrievalToolsActive(
      modelId,
      p.selectedModelRef?.providerId,
      p.rawInput,
      controller.signal
    )

    const output = await new ContextService().build({
      turnId: p.turnId ?? p.requestId,
      mode: p.mode ?? "new",
      model: modelId,
      providerId: p.selectedModelRef?.providerId,
      options: {
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
            version: 1,
            type: CHAT_STREAM_EVENT_TYPES.CONTEXT_PROGRESS,
            requestId: p.requestId,
            events
          }),
        toast: (warning) =>
          post({
            version: 1,
            type: CHAT_STREAM_EVENT_TYPES.CONTEXT_WARNING,
            requestId: p.requestId,
            payload: warning
          }),
        signal: controller.signal
      }
    })

    post({
      version: 1,
      type: CHAT_STREAM_EVENT_TYPES.CONTEXT_RESULT,
      requestId: p.requestId,
      result: output.result,
      receipt: output.receipt
    })
  } catch (error) {
    logger.error("Failed to build context", "handleBuildContext", { error })
    post({
      version: 1,
      type: CHAT_STREAM_EVENT_TYPES.CONTEXT_ERROR,
      requestId: p.requestId,
      failure: toAppFailure(error, {
        fallbackMessage: "Context build failed",
        context: "context-build"
      })
    })
  } finally {
    clearAbortController(p.requestId)
  }
}
