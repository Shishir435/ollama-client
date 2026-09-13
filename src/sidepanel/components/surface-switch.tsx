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
 * The preview marker is a dot rather than the word: at this size the word cost
 * more room than the two labels it sat beside, and it is the Agent tab's own
 * badge, not a third thing to read.
 */
export const SurfaceSwitch = () => {
  const { t } = useTranslation()

  return (
    <TabsList className="h-7 shrink-0 gap-0.5 p-0.5">
      <TabsTrigger value="chat" className="gap-1 px-2 text-2xs">
        <MessageCircle className="icon-xs" aria-hidden="true" />
        {t("agent.surface.chat")}
      </TabsTrigger>
      <TabsTrigger
        value="agent"
        className="gap-1 px-2 text-2xs"
        title={t("agent.surface.preview")}>
        <Bot className="icon-xs" aria-hidden="true" />
        {t("agent.surface.agent")}
        <span
          role="img"
          aria-label={t("agent.surface.preview")}
          className="size-1.5 rounded-full bg-app-agent"
        />
      </TabsTrigger>
    </TabsList>
  )
}
