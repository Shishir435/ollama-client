import { Globe } from "lucide-react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Toggle } from "@/components/ui/toggle"
import { useSelectedModelCapabilities } from "@/features/model/hooks/use-selected-model-capabilities"
import { useToolFallbackEnabled } from "@/features/model/hooks/use-tool-fallback-enabled"
import { openSettingsFocus } from "@/features/settings/open-settings-focus"
import { cn } from "@/lib/class-names"
import {
  useWebSearchActive,
  useWebSearchConfig
} from "../stores/web-search-config-store"

/** The per-model switch that lets a model without native tools use them. */
const TOOL_FALLBACK_FOCUS_ID = "model-tools-nonnative-fallback"

export const WebSearchToggle = () => {
  const { t } = useTranslation()
  const { config } = useWebSearchConfig()
  const { active, setActive } = useWebSearchActive()
  const { capabilities, isResolving, modelRef } = useSelectedModelCapabilities()
  const toolFallback = useToolFallbackEnabled(modelRef)

  // config.enabled means "configured in settings"; the toggle only controls
  // the per-device active flag so it never silently flips the settings switch.
  const configured = !!config.enabled
  if (!configured) return null

  /**
   * web_search is a tool: a model that can't tool-call runs it only through
   * the prompt-based fallback the user opted it into. Without either, show the
   * toggle blocked with an explanation instead of hiding it, so users learn
   * *why* web search is unavailable for this model.
   */
  const toolCallingSupported = capabilities?.toolCalling ?? false
  const blockedByModel = !toolCallingSupported && !isResolving && !toolFallback
  const label = blockedByModel
    ? `${t("chat.input.web_search_requires_tools")} ${t("chat.input.web_search_requires_tools_open")}`
    : t("chat.input.web_search_toggle_tooltip")

  return (
    <TooltipActionButton
      trigger={
        <Toggle
          pressed={active && !blockedByModel}
          /**
           * Not `disabled`: a dead control cannot say where the fix is, so a
           * blocked toggle stays pressable and opens the setting that lets a
           * model without tool calling use tools anyway.
           */
          aria-disabled={blockedByModel}
          onPressedChange={(next) => {
            if (blockedByModel) {
              void openSettingsFocus(TOOL_FALLBACK_FOCUS_ID)
              return
            }
            setActive(next)
          }}
          aria-label={label}
          className={cn(
            "size-7 p-0",
            blockedByModel
              ? "text-foreground-tertiary"
              : active
                ? "bg-transparent text-foreground hover:bg-state-hover aria-pressed:bg-transparent data-[state=on]:bg-transparent"
                : "text-muted-foreground hover:bg-state-hover"
          )}
        />
      }
      label={label}
      tooltipSide="top"
      icon={<Globe className="icon-sm" />}
    />
  )
}
