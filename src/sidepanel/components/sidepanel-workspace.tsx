import { lazy, Suspense, useCallback, useState } from "react"
import {
  AgentChatComposerContext,
  AgentSurfaceLauncherContext
} from "@/features/agent/lib/agent-surface-launcher"
import { Chat } from "@/features/chat/components/chat"
import { AgentRunRendererContext } from "@/features/chat/lib/agent-run-renderer"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { type PanelSurface, SurfaceToggle } from "./surface-toggle"

/**
 * The build constant is read inline, not through `AGENT_PREVIEW_ENABLED`: the
 * indirection defeats chunk elimination and ships the Agent chunk to Firefox.
 * The
 * `typeof` guard keeps the module importable where nothing defines it (vitest
 * without the define, component harnesses).
 */
const AgentSurface =
  typeof __AGENT_PREVIEW_ENABLED__ !== "undefined" && __AGENT_PREVIEW_ENABLED__
    ? lazy(() =>
        import("@/features/agent/agent-panel").then((module) => ({
          default: module.AgentPanel
        }))
      )
    : undefined

/** The card chat draws for a run's row, compiled out with the surface. */
const AgentRunCard =
  typeof __AGENT_PREVIEW_ENABLED__ !== "undefined" && __AGENT_PREVIEW_ENABLED__
    ? lazy(() =>
        import("@/features/agent/components/agent-run-message-card").then(
          (module) => ({ default: module.AgentRunMessageCard })
        )
      )
    : undefined

/** Asking about a run is answer-only: it stays in chat and reads the handoff. */
const focusChatComposer = () => chatInputStore.getState().requestFocus()

export const SidepanelWorkspace = () => {
  const [surface, setSurface] = useState<PanelSurface>("chat")
  /**
   * Coming back to chat re-reads the open conversation. A run started on the
   * Agent surface wrote its request and card rows from the background, which
   * the chat store never saw; without the re-read the card appears only after
   * a reload, which reads as the run having been lost.
   */
  const changeSurface = useCallback((next: PanelSurface) => {
    setSurface(next)
    if (next !== "chat") return
    const { currentSessionId, loadSessionMessages } =
      chatSessionStore.getState()
    if (currentSessionId) void loadSessionMessages(currentSessionId)
  }, [])
  const openAgent = useCallback(() => setSurface("agent"), [])

  if (!AgentSurface) return <Chat />

  /*
   * No bar of its own, and no tab strip. The toggle is handed to whichever
   * surface is showing and rendered in that surface's bottom control row,
   * beside the model picker — the row both surfaces now share. A full-width
   * row for a two-item switch was forty pixels of a four-hundred-pixel panel,
   * and a segmented control in the header put the mode one row away from the
   * controls that belong to it.
   */
  const toggle = <SurfaceToggle surface={surface} onChange={changeSurface} />

  return (
    <div className="flex h-screen min-w-0 flex-col bg-surface-chat">
      {surface === "chat" ? (
        <AgentRunRendererContext.Provider value={AgentRunCard}>
          <AgentSurfaceLauncherContext.Provider value={openAgent}>
            <AgentChatComposerContext.Provider value={focusChatComposer}>
              <Chat embedded leading={toggle} />
            </AgentChatComposerContext.Provider>
          </AgentSurfaceLauncherContext.Provider>
        </AgentRunRendererContext.Provider>
      ) : (
        <Suspense fallback={null}>
          <AgentSurface leading={toggle} />
        </Suspense>
      )}
    </div>
  )
}
