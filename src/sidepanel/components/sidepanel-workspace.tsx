import { lazy, Suspense } from "react"
import { AgentChatComposerContext } from "@/features/agent/lib/agent-chat-composer"
import { Chat } from "@/features/chat/components/chat"
import { AgentRunRendererContext } from "@/features/chat/lib/agent-run-renderer"
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

/** A follow-up is a chat message the user sends, drafted in the composer. */
const draftInChatComposer = (text?: string) => {
  const composer = chatInputStore.getState()
  if (text !== undefined) composer.setInput(text)
  composer.requestFocus()
}

/**
 * One workspace: the chat.
 *
 * A run is started by the chat model calling `browser_task`, supervised by its
 * card in the turn that started it, and followed up by sending another
 * message. The Agent lends chat two things and owns no screen of its own: the
 * card for a run's row, and the door back to the composer its follow-ups
 * use. Chat imports neither — the shell is the one place that knows both.
 *
 * Until the Agent chunk has loaded, and always on Firefox, this is plain chat.
 */
export const SidepanelWorkspace = () => {
  if (!AgentWorkspace) return <Chat />

  return (
    <div className="flex h-screen min-w-0 flex-col bg-surface-chat">
      <Suspense fallback={<Chat embedded />}>
        <AgentWorkspace>
          <AgentRunRendererContext.Provider value={AgentRunCard}>
            <AgentChatComposerContext.Provider value={draftInChatComposer}>
              <Chat embedded />
            </AgentChatComposerContext.Provider>
          </AgentRunRendererContext.Provider>
        </AgentWorkspace>
      </Suspense>
    </div>
  )
}
