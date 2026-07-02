import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Toggle } from "@/components/ui/toggle"
import { useSelectedModelCapabilities } from "@/features/model/hooks/use-selected-model-capabilities"
import { Globe } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import {
  useWebSearchActive,
  useWebSearchConfig
} from "../stores/web-search-config-store"

export const WebSearchToggle = () => {
  const { t } = useTranslation()
  const { config } = useWebSearchConfig()
  const { active, setActive } = useWebSearchActive()
  const { capabilities, isResolving } = useSelectedModelCapabilities()

  // config.enabled means "configured in settings"; the toggle only controls
  // the per-device active flag so it never silently flips the settings switch.
  const configured = !!config.enabled
  if (!configured) return null

  // web_search is a tool: a model that can't tool-call can never run it.
  // Show the toggle disabled with an explanation instead of hiding it, so
  // users learn *why* web search is unavailable for this model.
  const toolCallingSupported = capabilities?.toolCalling ?? false
  const blockedByModel = !toolCallingSupported && !isResolving
  const label = blockedByModel
    ? t("chat.input.web_search_requires_tools")
    : t("chat.input.web_search_toggle_tooltip")

  return (
    <TooltipActionButton
      trigger={
        <Toggle
          pressed={active && !blockedByModel}
          disabled={blockedByModel}
          onPressedChange={(next) => setActive(next)}
          aria-label={label}
          className={cn(
            "size-7 p-0",
            blockedByModel
              ? "text-muted-foreground/50"
              : active
                ? "bg-transparent text-foreground hover:bg-muted/55 aria-pressed:bg-transparent data-[state=on]:bg-transparent"
                : "text-muted-foreground hover:bg-muted/55"
          )}
        />
      }
      label={label}
      tooltipSide="top"
      icon={<Globe className="icon-sm" />}
    />
  )
}
