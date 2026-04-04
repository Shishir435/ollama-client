import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { openOptionsInTab } from "@/lib/browser-api"
import { Settings } from "@/lib/lucide-icon"

export const SettingsButton = ({
  showText = true,
  className,
  variant = "link",
  size = "sm",
  iconClassName
}: {
  showText?: boolean
  className?: string
  variant?:
    | "link"
    | "ghost"
    | "default"
    | "outline"
    | "secondary"
    | "destructive"
  size?: "default" | "sm" | "lg" | "icon"
  iconClassName?: string
}) => {
  const { t } = useTranslation()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          onClick={() => {
            void openOptionsInTab()
          }}
          aria-label={t("common.settings.aria_label")}>
          <Settings size="16" className={iconClassName || "opacity-80"} />
          {showText && <span>{t("common.settings.label")}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("common.settings.tooltip")}</TooltipContent>
    </Tooltip>
  )
}
