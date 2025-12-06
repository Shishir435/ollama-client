import { useStorage } from "@plasmohq/storage/hook"
import { AppWindow } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Toggle } from "@/components/ui/toggle"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
export const TabsToggle = () => {
  const { t } = useTranslation()
  const [tabAccess, setTabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    false
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          pressed={tabAccess}
          onPressedChange={setTabAccess}
          aria-label={t("tabs.toggle.label_on")}
          className={cn(
            "size-8 p-0",
            tabAccess
              ? "text-green-500 hover:text-green-600 hover:bg-muted"
              : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"
          )}>
          <AppWindow className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>
          {tabAccess ? t("tabs.toggle.label_on") : t("tabs.toggle.label_off")}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}
