import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { openOptionsInTab } from "@/lib/browser-api"
import { Settings } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

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
    <TooltipActionButton
      variant={variant}
      size={size}
      className={cn(className)}
      onClick={() => {
        void openOptionsInTab()
      }}
      ariaLabel={t("common.settings.aria_label")}
      tooltip={t("common.settings.tooltip")}
      label={t("common.settings.label")}
      showLabel={showText}
      icon={<Settings size="16" className={iconClassName || "opacity-80"} />}
    />
  )
}
