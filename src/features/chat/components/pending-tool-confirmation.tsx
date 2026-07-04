import { ShieldAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { runtime } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  type ApprovalScope,
  allowedScopesForRisk,
  defaultScopeForRisk
} from "@/lib/tools/approval/approval-policy"
import type { ChatMessage, ToolRun } from "@/types"

const runLabel = (run: ToolRun, t: (key: string) => string): string =>
  run.displayNameKey ? t(run.displayNameKey) : run.label

const SCOPE_LABEL_KEYS: Record<ApprovalScope, string> = {
  once: "chat.tool_confirmation.allow_once",
  session: "chat.tool_confirmation.allow_session",
  always: "chat.tool_confirmation.allow_always"
}

/**
 * Sticky approval prompt shown just above the composer while a tool call awaits
 * the user's decision. Scans the visible messages' tool runs for an
 * `awaiting-confirmation` status and posts the decision back via a CONFIRM_TOOL
 * runtime message (keyed by the tool-call id) with the chosen grant scope. The
 * offered scopes follow the tool's risk level: medium may be granted for the
 * chat at most, high adds "always allow" (but defaults to once), critical only
 * ever allows a single call. Renders nothing when idle.
 */
export const PendingToolConfirmation = ({
  messages,
  agentPaused = false
}: {
  messages: ChatMessage[]
  agentPaused?: boolean
}) => {
  const { t } = useTranslation()
  // Locally answered prompts hide instantly; the loop also updates the run
  // status. Keys are scoped to the owning message — callIds alone can repeat
  // across turns, and a bare-callId set would silently swallow the second
  // prompt while the background waits forever.
  const [responded, setResponded] = useState<Set<string>>(new Set())
  const surfaceRef = useRef<HTMLDivElement>(null)

  const respond = (
    key: string,
    callId: string,
    approved: boolean,
    scope?: ApprovalScope
  ) => {
    setResponded((prev) => new Set(prev).add(key))
    void runtime
      .sendMessage({
        type: MESSAGE_KEYS.PROVIDER.CONFIRM_TOOL,
        payload: { callId, approved, scope }
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

  useEffect(() => {
    if (pending.length === 0) return
    const keepAlive = () => {
      void runtime
        .sendMessage({ type: MESSAGE_KEYS.APP.KEEP_TOOL_LOOP_ALIVE })
        .catch(() => undefined)
    }
    keepAlive()
    const interval = window.setInterval(keepAlive, 20_000)
    return () => window.clearInterval(interval)
  }, [pending.length])

  useEffect(() => {
    if (pending.length > 0) surfaceRef.current?.focus()
  }, [pending.length])

  if (pending.length === 0 || agentPaused) return null

  return (
    <div
      ref={surfaceRef}
      className="mx-auto mb-2 max-w-4xl px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={-1}
      role="alert"
      aria-live="assertive"
      onKeyDown={(event) => {
        const first = pending[0]
        if (!first || !surfaceRef.current?.contains(document.activeElement)) {
          return
        }
        if (event.key.toLowerCase() === "y") {
          event.preventDefault()
          respond(
            first.key,
            first.run.callId,
            true,
            defaultScopeForRisk(first.run.risk ?? "high")
          )
        }
        if (event.key.toLowerCase() === "n") {
          event.preventDefault()
          respond(first.key, first.run.callId, false)
        }
      }}>
      {pending.map(({ run, key }) => {
        // A run that paused for approval is at least high risk unless declared
        // otherwise — never offer broad grants on missing metadata.
        const risk = run.risk ?? "high"
        const scopes = allowedScopesForRisk(risk)
        const primaryScope = defaultScopeForRisk(risk)

        return (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-panel border border-app-primary/30 bg-app-primary-soft/50 p-2.5 text-xs shadow-xs">
            <div className="flex items-start gap-2">
              <ShieldAlert className="icon-sm mt-0.5 shrink-0 text-app-primary" />
              <div className="min-w-0">
                <div className="font-medium">
                  {t("chat.tool_confirmation.title")}
                </div>
                <div className="mt-0.5 font-medium text-app-primary">
                  {t("chat.tool_confirmation.risk_label", {
                    risk: t(`chat.tool_confirmation.risk.${risk}`)
                  })}
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {run.approvalPreview ??
                    t("chat.tool_confirmation.body", {
                      action: runLabel(run, t)
                    })}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => respond(key, run.callId, false)}>
                {t("chat.tool_confirmation.deny")}
              </Button>
              {scopes
                .filter((scope) => scope !== primaryScope)
                .map((scope) => (
                  <Button
                    key={scope}
                    variant="outline"
                    size="sm"
                    onClick={() => respond(key, run.callId, true, scope)}>
                    {t(SCOPE_LABEL_KEYS[scope])}
                  </Button>
                ))}
              <Button
                size="sm"
                onClick={() => respond(key, run.callId, true, primaryScope)}>
                {t(SCOPE_LABEL_KEYS[primaryScope])}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
