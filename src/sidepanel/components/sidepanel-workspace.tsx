import { lazy, Suspense, useState } from "react"
import { Tabs } from "@/components/ui/tabs"
import { Chat } from "@/features/chat/components/chat"
import { SurfaceSwitch } from "./surface-switch"

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
  const [surface, setSurface] = useState<"chat" | "agent">("chat")

  if (!AgentSurface) return <Chat />

  return (
    <div className="flex h-screen min-w-0 flex-col bg-surface-chat">
      <Tabs
        value={surface}
        onValueChange={(value) => setSurface(value as "chat" | "agent")}
        className="min-h-0 flex-1 gap-0">
        {/*
          No bar of its own. The switch is handed to whichever surface is
          showing and rendered in that surface's own header row, because a
          full-width row for a two-item toggle is forty pixels of a
          four-hundred-pixel panel and it put the mode a person is in one row
          away from the state that mode is in.
        */}
        <div className="min-h-0 flex-1">
          {surface === "chat" ? (
            <Chat embedded leading={<SurfaceSwitch compact />} />
          ) : (
            <Suspense fallback={null}>
              <AgentSurface leading={<SurfaceSwitch compact />} />
            </Suspense>
          )}
        </div>
      </Tabs>
    </div>
  )
}
