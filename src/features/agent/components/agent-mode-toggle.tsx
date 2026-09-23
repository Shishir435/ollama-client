import { Bot, MessageCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"

/**
 * One button that moves the composer between sending a message and sending
 * a task.
 *
 * It names the mode it goes *to*, not the one you are in — a button says
 * what pressing it does — and the preview marker rides along only when it
 * points at the Agent, because that is what the marker is about. An icon
 * with a tooltip, like every other control in the composer's row.
 */
export const AgentModeToggle = ({
  acting,
  onChange
}: {
  acting: boolean
  onChange: (acting: boolean) => void
}) => {
  const { t } = useTranslation()
  const label = acting
    ? t("agent.surface.chat")
    : `${t("agent.surface.agent")} · ${t("agent.surface.preview")}`

  return (
    <TooltipActionButton
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={acting}
          onClick={() => onChange(!acting)}
          className="relative shrink-0 rounded-control text-muted-foreground hover:bg-state-hover hover:text-foreground"
        />
      }
      label={label}
      icon={
        <span className="relative inline-flex">
          {acting ? (
            <MessageCircle className="icon-sm" aria-hidden="true" />
          ) : (
            <Bot className="icon-sm" aria-hidden="true" />
          )}
          {!acting && (
            <span
              aria-hidden="true"
              className="-right-0.5 -top-0.5 absolute size-1.5 rounded-full bg-app-agent"
            />
          )}
        </span>
      }
    />
  )
}
