import { useCallback } from "react"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ActivityEvent, BuildContextRequestPayload } from "@/types"

import type { BuildRagContextResult } from "./build-rag-context"

interface BuildContextCallbacks {
  /** Live activity trace, streamed from the background as retrieval progresses. */
  onActivityEvent?: (events: ActivityEvent[]) => void
  /** User-facing warning (e.g. RAG failure) forwarded from the background. */
  toast?: (input: {
    variant?: "default" | "destructive"
    title: string
    description?: string
  }) => void
}

type BuildContextPortMessage =
  | { type: "context_progress"; requestId: string; events: ActivityEvent[] }
  | {
      type: "context_warning"
      requestId: string
      payload: {
        variant?: "default" | "destructive"
        title: string
        description?: string
      }
    }
  | { type: "context_result"; requestId: string; result: BuildRagContextResult }
  | { type: "context_error"; requestId: string; error: string }

/**
 * Runs turn context building in the background over the provider stream port
 * and resolves with the assembled result. Retrieval, embeddings, and query
 * reformulation all happen in the background (the sole context owner); this
 * hook only ships the request and relays streamed progress into the UI so the
 * activity trace updates live.
 */
export const useBuildContext = () => {
  const buildContext = useCallback(
    (
      request: Omit<BuildContextRequestPayload, "requestId">,
      callbacks?: BuildContextCallbacks
    ): Promise<BuildRagContextResult> =>
      new Promise<BuildRagContextResult>((resolve, reject) => {
        const requestId =
          globalThis.crypto?.randomUUID?.() ??
          `ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const port = browser.runtime.connect({
          name: MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE
        })
        let settled = false

        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          try {
            port.disconnect()
          } catch {
            // Port already gone — nothing to clean up.
          }
          fn()
        }

        const listener = (raw: unknown) => {
          const msg = raw as BuildContextPortMessage
          if (!msg?.type || msg.requestId !== requestId) return
          switch (msg.type) {
            case "context_progress":
              callbacks?.onActivityEvent?.(msg.events)
              break
            case "context_warning":
              callbacks?.toast?.(msg.payload)
              break
            case "context_result":
              finish(() => resolve(msg.result))
              break
            case "context_error":
              finish(() => reject(new Error(msg.error)))
              break
          }
        }

        port.onMessage.addListener(listener)
        port.onDisconnect.addListener(() =>
          finish(() =>
            reject(new Error("Context build port disconnected before result"))
          )
        )

        port.postMessage({
          type: MESSAGE_KEYS.PROVIDER.BUILD_CONTEXT,
          payload: { ...request, requestId }
        })
      }),
    []
  )

  return { buildContext }
}
