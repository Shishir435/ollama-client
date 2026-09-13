import { Bot, MessageCircle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * The Chat/Agent switch, sized to sit beside a surface's own controls.
 *
 * It had a full-width row of its own above the panel, which is forty pixels of
 * a four-hundred-pixel-wide surface spent on a two-item toggle, and it put the
 * mode a person is in one row away from the state that mode is in. It is auto
 * width now and rendered by each surface's header, so the two read as one bar.
 *
 * It belongs in that header and not in the composer, which is where it was
 * tried next. This control changes the whole surface; the composer is the
 * affordance for writing one message, so a two-glyph segment sitting inside it
 * beside the model picker reads as another setting for the message about to be
 * sent. What made the header feel full was never this — it was a privacy chip
 * claiming "Local" for a loopback proxy and a chat instruction filed under
 * status, and both of those have gone somewhere better.
 *
 * The preview marker is a dot rather than the word: at this size the word cost
 * more room than the two labels it sat beside, and it is the Agent tab's own
 * badge, not a third thing to read.
 */
export const SurfaceSwitch = () => {
  const { t } = useTranslation()

  return (
    /*
     * The switch is the row's flexible element: it is the widest thing in the
     * bar and its labels are the most redundant, since each tab carries an
     * icon that says the same thing. So its labels truncate under pressure
     * while the readouts beside it — a speed, a status — keep their whole
     * value. Letting those wrap instead broke "avg 122.6 t/s" across three
     * lines.
     *
     * The two tabs share that pressure equally (`flex-1 basis-0`). Letting
     * them size to their own content made the selected one keep its label
     * while the other lost every letter, so the switch changed width and
     * shape depending on which side you were on.
     */
    <TabsList className="h-7 min-w-0 gap-0.5 p-0.5">
      <TabsTrigger
        value="chat"
        className="min-w-0 flex-1 basis-0 gap-1 px-2 text-2xs">
        <MessageCircle className="icon-xs shrink-0" aria-hidden="true" />
        <span className="truncate">{t("agent.surface.chat")}</span>
      </TabsTrigger>
      <TabsTrigger
        value="agent"
        className="min-w-0 flex-1 basis-0 gap-1 px-2 text-2xs"
        title={t("agent.surface.preview")}>
        <Bot className="icon-xs shrink-0" aria-hidden="true" />
        <span className="truncate">{t("agent.surface.agent")}</span>
        <span
          role="img"
          aria-label={t("agent.surface.preview")}
          className="size-1.5 shrink-0 rounded-full bg-app-agent"
        />
      </TabsTrigger>
    </TabsList>
  )
}
