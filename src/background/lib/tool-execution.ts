/**
 * Shared tool-execution primitives used by both the native tool loop
 * (`stream-chat-with-tools.ts`) and the non-native prompt-based fallback
 * (`stream-chat-with-non-native-tools.ts`).
 *
 * These cover the parts that must behave identically regardless of how the model
 * requested the tool: timeout/abort racing, result trimming, image extraction,
 * and finalizing the `ToolRun` trace entry. Message formatting differs between
 * the two paths (native `tool`-role replies vs `<tool_response>` user turns), so
 * that is intentionally left to each caller.
 */

import type {
  ToolCall,
  ToolContext,
  ToolRegistry,
  ToolResult,
  ToolRuntimePolicy
} from "@/lib/tools"
import { resolveToolRuntimePolicy } from "@/lib/tools"
import { hasAlwaysGrant } from "@/lib/tools/approval/approval-grants"
import {
  confirmationRequired,
  effectiveRisk
} from "@/lib/tools/approval/approval-policy"
import {
  clearAgentPageActionHighlight,
  isAgentBrowserTool,
  isAgentElementActionTool,
  isAgentNavigationTool,
  isAgentPageActionTool,
  originForNonElementAgentToolCall,
  preflightAgentPageAction
} from "@/lib/tools/internal/agent-browser-tools"
import type { ChatMessage, ImageAttachment, ToolRun } from "@/types"
import { awaitToolConfirmation } from "./tool-confirmation-registry"
import { hasSessionGrant } from "./tool-session-grants"

export interface PreparedToolCall {
  call: ToolCall
  run: ToolRun
  policy: ToolRuntimePolicy
  /**
   * Pause for explicit user approval before running. Resolved from the tool's
   * risk level and any standing grants (see `approval-policy.ts`), not a
   * per-tool boolean.
   */
  requiresConfirmation: boolean
  origin?: string
  preflightError?: string
}

// The reasoning-trace component translates known tool ids (rag_search, etc.);
// the raw name is the fallback label for any tool it doesn't special-case.
export const labelForTool = (name: string): string => name

/** Race a tool call against a timeout so a hung tool can't stall the stream. */
export const callWithTimeout = (
  run: Promise<ToolResult>,
  name: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ToolResult> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined

  const timeoutPromise = new Promise<ToolResult>((resolve) => {
    timeoutId = setTimeout(
      () =>
        resolve({
          content: `Tool "${name}" timed out after ${timeoutMs / 1000}s.`,
          isError: true
        }),
      timeoutMs
    )
  })

  const abortPromise = new Promise<ToolResult>((resolve) => {
    abortHandler = () =>
      resolve({
        content: `Tool "${name}" was stopped by the user.`,
        isError: true
      })
    if (signal?.aborted) abortHandler()
    else signal?.addEventListener("abort", abortHandler, { once: true })
  })

  return Promise.race([run, timeoutPromise, abortPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId)
    if (abortHandler) signal?.removeEventListener("abort", abortHandler)
  })
}

/** Trim a tool result to the char cap, appending a model-visible note. */
const trimToolResult = (
  content: string,
  maxChars: number
): { content: string; truncated: boolean } => {
  if (content.length <= maxChars) return { content, truncated: false }
  const note = `\n\n[Tool result trimmed to ${maxChars} characters to keep responses fast. The user can change this limit in Settings → Context.]`
  return { content: content.slice(0, maxChars) + note, truncated: true }
}

/** Decoded byte size of a base64 string (no decoding), accounting for padding. */
const base64ByteSize = (base64: string): number => {
  if (!base64) return 0
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.floor((base64.length * 3) / 4) - padding
}

/**
 * Turn a tool result's images into a follow-up user message, the only role that
 * carries images on Ollama / OpenAI-compatible providers. Returns undefined when
 * the tool produced no images.
 */
export const buildImageMessage = (
  call: ToolCall,
  result: ToolResult
): ChatMessage | undefined => {
  if (!result.images?.length) return undefined
  const images: ImageAttachment[] = result.images.map((image, index) => ({
    imageId: `${call.id}:image:${index}`,
    fileName: `${call.name}-${index}.${image.mimeType === "image/png" ? "png" : "jpg"}`,
    mimeType: image.mimeType,
    // Decoded byte size — `base64.length` would overstate it by ~33%.
    size: base64ByteSize(image.base64),
    base64: image.base64
  }))
  return {
    role: "user",
    content: `Image result from the "${call.name}" tool:`,
    images
  }
}

/** Build a running trace entry + resolved policy for a requested tool call. */
export const prepareToolCall = async (
  registry: ToolRegistry,
  call: ToolCall,
  toolResultMaxChars?: number,
  ctx?: ToolContext
): Promise<PreparedToolCall> => {
  const definition = await registry.getDefinition(call.name)
  const policy = resolveToolRuntimePolicy(
    definition,
    toolResultMaxChars !== undefined
      ? { maxResultChars: toolResultMaxChars }
      : undefined
  )
  // Low risk never prompts — skip the grant lookup (a storage read) entirely,
  // which is the hot path for read-only tools.
  const risk = effectiveRisk(definition)
  let preflight:
    | Awaited<ReturnType<typeof preflightAgentPageAction>>
    | undefined
  let preflightError: string | undefined
  if (ctx?.agent && isAgentBrowserTool(call.name) && call.name !== "open_tab") {
    if (call.arguments.tabId === undefined) {
      call.arguments.tabId = ctx.agent.targetTabId
    }
    if (call.arguments.tabId !== ctx.agent.targetTabId) {
      preflightError =
        "Agent target-tab mismatch. The run cannot act on a different tab."
    }
  }
  if (!preflightError && isAgentElementActionTool(call.name)) {
    try {
      preflight = await preflightAgentPageAction(call)
    } catch (error) {
      preflightError = error instanceof Error ? error.message : String(error)
    }
  }
  const origin =
    preflight?.origin ??
    (isAgentBrowserTool(call.name) && !isAgentElementActionTool(call.name)
      ? await originForNonElementAgentToolCall(call).catch(() => undefined)
      : undefined)
  const expandsOrigin =
    Boolean(ctx?.agent) &&
    isAgentNavigationTool(call.name) &&
    Boolean(origin) &&
    !ctx?.agent?.allowedOrigins.includes(origin as string)
  const requiresConfirmation =
    risk === "low"
      ? false
      : expandsOrigin ||
        confirmationRequired(definition, {
          hasSessionGrant: hasSessionGrant(ctx?.sessionId, call.name, origin),
          hasAlwaysGrant: await hasAlwaysGrant(call.name, origin)
        })
  return {
    call,
    policy,
    requiresConfirmation,
    origin,
    preflightError,
    run: {
      toolId: call.name,
      callId: call.id,
      label: labelForTool(call.name),
      displayNameKey: definition?.displayNameKey,
      iconKey: definition?.iconKey,
      category: definition?.category,
      risk: definition?.risk,
      status: "running",
      startedAt: Date.now(),
      origin,
      approvalPreview: preflight?.preview,
      args:
        call.arguments && Object.keys(call.arguments).length > 0
          ? call.name === "type"
            ? {
                ...call.arguments,
                text:
                  typeof call.arguments.text === "string"
                    ? `[redacted ${call.arguments.text.length} characters]`
                    : "[redacted]"
              }
            : call.arguments
          : undefined
    }
  }
}

/**
 * Execute a prepared tool call and finalize its trace entry. Runs the tool with
 * a timeout/abort race (or short-circuits when the policy disables it), trims
 * the result to the policy cap, and mutates `prepared.run` with the outcome
 * (status, preview, sources, truncation). Returns the raw result plus the
 * trimmed, model-visible content; the caller decides how to format it back into
 * the conversation.
 */
export const runPreparedToolCall = async (
  prepared: PreparedToolCall,
  registry: ToolRegistry,
  ctx: ToolContext,
  signal?: AbortSignal,
  /** Re-emit the trace so the UI reflects awaiting/running transitions live. */
  emitTrace?: () => void,
  /**
   * Force-persist resumable loop state after the trace enters
   * `awaiting-confirmation`, before the in-memory promise starts waiting.
   */
  persistAwaitingConfirmation?: () => Promise<void>
): Promise<{ result: ToolResult; content: string }> => {
  const { call, policy, run } = prepared
  if (prepared.preflightError) {
    await clearAgentPageActionHighlight(call)
    run.status = "error"
    run.completedAt = Date.now()
    run.error = prepared.preflightError
    return {
      result: { content: prepared.preflightError, isError: true },
      content: prepared.preflightError
    }
  }
  if (ctx.agent) {
    if (isAgentBrowserTool(call.name) && call.name !== "open_tab") {
      if (call.arguments.tabId === undefined) {
        call.arguments.tabId = ctx.agent.targetTabId
      }
      if (call.arguments.tabId !== ctx.agent.targetTabId) {
        const mismatch =
          "Agent target-tab mismatch. The run cannot act on a different tab."
        run.status = "error"
        run.completedAt = Date.now()
        run.error = mismatch
        await clearAgentPageActionHighlight(call)
        return {
          result: { content: mismatch, isError: true },
          content: mismatch
        }
      }
    }
    if (Date.now() - ctx.agent.startedAt >= ctx.agent.maxActiveMs) {
      const capped = "Browser-agent active-time limit reached."
      run.status = "error"
      run.completedAt = Date.now()
      run.error = capped
      ctx.agent.capReason = capped
      await clearAgentPageActionHighlight(call)
      return { result: { content: capped, isError: true }, content: capped }
    }
    if (
      isAgentPageActionTool(call.name) &&
      ctx.agent.actionCount >= ctx.agent.maxActions
    ) {
      const capped = "Browser-agent page-action limit reached."
      run.status = "error"
      run.completedAt = Date.now()
      run.error = capped
      ctx.agent.capReason = capped
      await clearAgentPageActionHighlight(call)
      return { result: { content: capped, isError: true }, content: capped }
    }
  }

  // Confirmation-gated tools pause for explicit user approval before running.
  // A denial (or an abort while waiting) returns a declined result to the model
  // instead of executing — the tool never runs without a yes.
  if (prepared.requiresConfirmation) {
    if (
      ctx.agent &&
      isAgentElementActionTool(call.name) &&
      prepared.origin &&
      !ctx.agent.allowedOrigins.includes(prepared.origin)
    ) {
      const error = `Agent origin boundary blocked ${prepared.origin}. Navigate there with explicit approval first.`
      await clearAgentPageActionHighlight(call)
      run.status = "error"
      run.completedAt = Date.now()
      run.error = error
      emitTrace?.()
      return {
        result: { content: run.error, isError: true },
        content: run.error
      }
    }
    run.status = "awaiting-confirmation"
    emitTrace?.()
    await persistAwaitingConfirmation?.()
    const approved = await awaitToolConfirmation(
      call.id,
      {
        toolName: call.name,
        sessionId: ctx.sessionId,
        origin: prepared.origin
      },
      signal
    )
    if (!approved) {
      await clearAgentPageActionHighlight(call)
      run.status = "error"
      run.completedAt = Date.now()
      run.error = "Declined by the user."
      emitTrace?.()
      const declined = "The user declined this action, so it was not performed."
      return { result: { content: declined, isError: true }, content: declined }
    }
    run.status = "running"
    emitTrace?.()
  }

  const result = policy.enabled
    ? await callWithTimeout(
        registry.call(call.name, call.arguments, ctx),
        call.name,
        policy.timeoutMs,
        signal
      )
    : { content: `Tool "${call.name}" is disabled.`, isError: true }
  if (ctx.agent && !result.isError && isAgentPageActionTool(call.name)) {
    ctx.agent.actionCount += 1
  }
  await clearAgentPageActionHighlight(call)

  const { content, truncated } = trimToolResult(
    result.content,
    policy.maxResultChars
  )

  run.status = result.isError ? "error" : "done"
  run.completedAt = Date.now()
  // Use the trimmed content for the trace too, so the UI and the model see
  // the same capped payload.
  if (result.isError) run.error = content
  else run.resultPreview = content.slice(0, 240)
  if (result.sources?.length) {
    run.sources = result.sources.map((source, index) => ({
      ...source,
      id: `${call.id}:${source.id ?? index}`
    }))
  }
  if (truncated) run.truncated = true

  return { result, content }
}
