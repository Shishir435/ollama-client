import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import browser from "@/lib/browser-api"
import { Settings } from "@/lib/lucide-icon"

export const SettingsButton = ({ showText = true }: { showText?: boolean }) => {
  const { t } = useTranslation()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            browser.runtime.openOptionsPage()
          }}
          aria-label={t("common.settings.aria_label")}>
          <Settings size="16" className="opacity-80" />
          {showText && <span>{t("common.settings.label")}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("common.settings.tooltip")}</TooltipContent>
    </Tooltip>
  )
}
