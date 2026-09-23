import { lazy, Suspense } from "react"
import { AgentChatComposerContext } from "@/features/agent/lib/agent-chat-composer"
import { Chat } from "@/features/chat/components/chat"
import { AgentRunRendererContext } from "@/features/chat/lib/agent-run-renderer"
import { ChatComposerModeContext } from "@/features/chat/lib/composer-mode"
import { chatInputStore } from "@/features/chat/stores/chat-input-store"

/**
 * The build constant is read inline, not through `AGENT_PREVIEW_ENABLED`: the
 * indirection defeats chunk elimination and ships the Agent chunk to Firefox.
 * The `typeof` guard keeps the module importable where nothing defines it
 * (vitest without the define, component harnesses).
 */
const AgentWorkspace =
  typeof __AGENT_PREVIEW_ENABLED__ !== "undefined" && __AGENT_PREVIEW_ENABLED__
    ? lazy(() =>
        import("@/features/agent/agent-workspace").then((module) => ({
          default: module.AgentWorkspace
        }))
      )
    : undefined

/** The card chat draws for a run's row, compiled out with the Agent. */
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

/**
 * One workspace: the chat.
 *
 * There used to be two surfaces and a switch between them. A run is now
 * started from the chat composer in Act mode, supervised by its card in the
 * conversation, and followed up from that card, so the Agent lends chat three
 * things and owns no screen of its own: the composer mode and its switch, the
 * card for a run's row, and the door back to the composer for asking about a
 * run. Chat imports none of it — the shell is the one place that knows both.
 *
 * Until the Agent chunk has loaded, and always on Firefox, this is plain chat.
 */
export const SidepanelWorkspace = () => {
  if (!AgentWorkspace) return <Chat />

  return (
    <div className="flex h-screen min-w-0 flex-col bg-surface-chat">
      <Suspense fallback={<Chat embedded />}>
        <AgentWorkspace>
          {({ toggle, mode }) => (
            <AgentRunRendererContext.Provider value={AgentRunCard}>
              <AgentChatComposerContext.Provider value={focusChatComposer}>
                <ChatComposerModeContext.Provider value={mode}>
                  <Chat embedded leading={toggle} />
                </ChatComposerModeContext.Provider>
              </AgentChatComposerContext.Provider>
            </AgentRunRendererContext.Provider>
          )}
        </AgentWorkspace>
      </Suspense>
    </div>
  )
}
