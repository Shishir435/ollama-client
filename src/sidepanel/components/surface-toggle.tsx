import { Bot, MessageCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"

export type PanelSurface = "chat" | "agent"

/**
 * One button that moves between the two surfaces.
 *
 * It was a segmented control with two labels, which is the honest shape for a
 * switch but the wrong one for where it has to live: the bottom control row is
 * five icon buttons wide already, and a labelled pill among them reads as a
 * different kind of thing and takes the room of two of them. A single icon
 * with a tooltip is what every other control in that row is.
 *
 * It names the surface it goes *to*, not the one you are on — a button says
 * what pressing it does. The preview marker rides along only when it points at
 * the Agent, because that is what the marker is about.
 */
export const SurfaceToggle = ({
  surface,
  onChange
}: {
  surface: PanelSurface
  onChange: (surface: PanelSurface) => void
}) => {
  const { t } = useTranslation()
  const target: PanelSurface = surface === "chat" ? "agent" : "chat"
  const label =
    target === "agent"
      ? `${t("agent.surface.agent")} · ${t("agent.surface.preview")}`
      : t("agent.surface.chat")

  return (
    <TooltipActionButton
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={() => onChange(target)}
          className="relative shrink-0 rounded-control text-muted-foreground hover:bg-state-hover hover:text-foreground"
        />
      }
      label={label}
      icon={
        <span className="relative inline-flex">
          {target === "agent" ? (
            <Bot className="icon-sm" aria-hidden="true" />
          ) : (
            <MessageCircle className="icon-sm" aria-hidden="true" />
          )}
          {target === "agent" && (
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
