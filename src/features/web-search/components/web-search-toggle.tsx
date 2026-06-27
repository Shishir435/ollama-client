import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Toggle } from "@/components/ui/toggle"
import { useSelectedModelCapabilities } from "@/features/model/hooks/use-selected-model-capabilities"
import { Globe } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import { useWebSearchConfig } from "../stores/web-search-config-store"

export const WebSearchToggle = () => {
  const { t } = useTranslation()
  const { config, updateConfig } = useWebSearchConfig()
  const { capabilities, isResolving } = useSelectedModelCapabilities()
  const enabled = !!config.enabled

  // web_search is a tool: a model that can't tool-call can never run it, so
  // don't offer the toggle. Mirror the vision gating in the composer — keep it
  // shown while capabilities are still resolving to avoid a show-then-hide
  // flicker, and only hide once the model is definitively non-tool-calling.
  const toolCallingSupported = capabilities?.toolCalling ?? false
  if (!toolCallingSupported && !isResolving) return null

  return (
    <TooltipActionButton
      trigger={
        <Toggle
          pressed={enabled}
          onPressedChange={(next) => updateConfig({ enabled: next })}
          aria-label={t("chat.input.web_search_toggle_tooltip")}
          className={cn(
            "size-7 p-0",
            enabled
              ? "bg-transparent text-foreground hover:bg-muted/55 aria-pressed:bg-transparent data-[state=on]:bg-transparent"
              : "text-muted-foreground hover:bg-muted/55"
          )}
        />
      }
      label={t("chat.input.web_search_toggle_tooltip")}
      tooltipSide="top"
      icon={<Globe className="icon-sm" />}
    />
  )
}
