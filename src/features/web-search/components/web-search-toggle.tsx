import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Toggle } from "@/components/ui/toggle"
import { Globe } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import { useWebSearchConfig } from "../stores/web-search-config-store"

export const WebSearchToggle = () => {
  const { t } = useTranslation()
  const { config, updateConfig } = useWebSearchConfig()
  const enabled = !!config.enabled

  return (
    <TooltipActionButton
      trigger={
        <Toggle
          pressed={enabled}
          onPressedChange={(next) => updateConfig({ enabled: next })}
          aria-label={t("chat.input.web_search_toggle_tooltip")}
          className={cn(
            "size-8 p-0",
            enabled
              ? "bg-transparent text-foreground hover:bg-muted/55 aria-pressed:bg-transparent data-[state=on]:bg-transparent"
              : "text-muted-foreground hover:bg-muted/55"
          )}
        />
      }
      label={t("chat.input.web_search_toggle_tooltip")}
      tooltipSide="top"
      icon={<Globe className="icon-md" />}
    />
  )
}
