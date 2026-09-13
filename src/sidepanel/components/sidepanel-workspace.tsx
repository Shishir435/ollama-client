import { lazy, Suspense, useState } from "react"
import { Chat } from "@/features/chat/components/chat"
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

export const SidepanelWorkspace = () => {
  const [surface, setSurface] = useState<PanelSurface>("chat")

  if (!AgentSurface) return <Chat />

  /*
   * No bar of its own, and no tab strip. The toggle is handed to whichever
   * surface is showing and rendered in that surface's bottom control row,
   * beside the model picker — the row both surfaces now share. A full-width
   * row for a two-item switch was forty pixels of a four-hundred-pixel panel,
   * and a segmented control in the header put the mode one row away from the
   * controls that belong to it.
   */
  const toggle = <SurfaceToggle surface={surface} onChange={setSurface} />

  return (
    <div className="flex h-screen min-w-0 flex-col bg-surface-chat">
      {surface === "chat" ? (
        <Chat embedded leading={toggle} />
      ) : (
        <Suspense fallback={null}>
          <AgentSurface leading={toggle} />
        </Suspense>
      )}
    </div>
  )
}
