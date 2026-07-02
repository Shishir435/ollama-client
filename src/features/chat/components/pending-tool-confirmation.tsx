import { ShieldAlert } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { runtime } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChatMessage, ToolRun } from "@/types"

const runLabel = (run: ToolRun, t: (key: string) => string): string =>
  run.displayNameKey ? t(run.displayNameKey) : run.label

/**
 * Sticky approval prompt shown just above the composer while a tool call awaits
 * the user's decision. Scans the visible messages' tool runs for an
 * `awaiting-confirmation` status and posts the decision back via a CONFIRM_TOOL
 * runtime message (keyed by the tool-call id). Renders nothing when idle.
 */
export const PendingToolConfirmation = ({
  messages
}: {
  messages: ChatMessage[]
}) => {
  const { t } = useTranslation()
  // Locally answered prompts hide instantly; the loop also updates the run
  // status. Keys are scoped to the owning message — callIds alone can repeat
  // across turns, and a bare-callId set would silently swallow the second
  // prompt while the background waits forever.
  const [responded, setResponded] = useState<Set<string>>(new Set())

  const respond = (key: string, callId: string, approved: boolean) => {
    setResponded((prev) => new Set(prev).add(key))
    void runtime
      .sendMessage({
        type: MESSAGE_KEYS.PROVIDER.CONFIRM_TOOL,
        payload: { callId, approved }
      })
      .catch((error: unknown) => {
        // If the service worker was reaped, the pending confirmation is gone
        // with it — the stream ended too, so there is nothing to recover.
        logger.warn("Tool confirmation reply failed", "PendingToolConfirm", {
          error
        })
      })
  }

  const pending = messages.flatMap((message, messageIndex) =>
    (message.metrics?.toolRuns ?? [])
      .filter(
        (run): run is ToolRun & { callId: string } =>
          run.status === "awaiting-confirmation" && run.callId !== undefined
      )
      .map((run) => ({
        run,
        key: `${message.id ?? messageIndex}:${run.callId}`
      }))
      .filter(({ key }) => !responded.has(key))
  )

  if (pending.length === 0) return null

  return (
    <div className="mx-auto mb-2 max-w-4xl px-2">
      {pending.map(({ run, key }) => (
        <div
          key={key}
          className="flex flex-col gap-2 rounded-panel border border-app-primary/30 bg-app-primary-soft/50 p-2.5 text-xs shadow-xs">
          <div className="flex items-start gap-2">
            <ShieldAlert className="icon-sm mt-0.5 shrink-0 text-app-primary" />
            <div className="min-w-0">
              <div className="font-medium">
                {t("chat.tool_confirmation.title")}
              </div>
              <div className="mt-0.5 text-muted-foreground">
                {t("chat.tool_confirmation.body", { action: runLabel(run, t) })}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => respond(key, run.callId, false)}>
              {t("chat.tool_confirmation.deny")}
            </Button>
            <Button size="sm" onClick={() => respond(key, run.callId, true)}>
              {t("chat.tool_confirmation.allow")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
