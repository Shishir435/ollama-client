import { Bot, MessageCircle } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Chat } from "@/features/chat/components/chat"

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
  const { t } = useTranslation()
  const [surface, setSurface] = useState<"chat" | "agent">("chat")

  if (!AgentSurface) return <Chat />

  return (
    <div className="flex h-screen min-w-0 flex-col bg-surface-chat">
      <Tabs
        value={surface}
        onValueChange={(value) => setSurface(value as "chat" | "agent")}
        className="min-h-0 flex-1 gap-0">
        <div className="shrink-0 border-b border-border/40 bg-background/90 px-2 py-1.5 backdrop-blur">
          <TabsList className="grid h-7 w-full grid-cols-2">
            <TabsTrigger value="chat">
              <MessageCircle className="icon-xs" aria-hidden="true" />
              {t("agent.surface.chat")}
            </TabsTrigger>
            <TabsTrigger value="agent">
              <Bot className="icon-xs" aria-hidden="true" />
              {t("agent.surface.agent")}
              <span className="rounded-sm bg-app-primary-soft px-1 text-micro text-app-agent">
                {t("agent.surface.preview")}
              </span>
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1">
          {surface === "chat" ? (
            <Chat embedded />
          ) : (
            <Suspense fallback={null}>
              <AgentSurface />
            </Suspense>
          )}
        </div>
      </Tabs>
    </div>
  )
}
