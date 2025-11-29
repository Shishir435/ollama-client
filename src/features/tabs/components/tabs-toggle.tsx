import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"

import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

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
        <div className="flex cursor-pointer items-center space-x-2">
          <Switch
            id="tabs-switch"
            checked={tabAccess}
            onCheckedChange={setTabAccess}
          />
          {tabAccess ? (
            <span>{t("tabs.toggle.label_on")}</span>
          ) : (
            <label htmlFor="tabs-switch" className="text-sm">
              {t("tabs.toggle.label_off")}
            </label>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{t("tabs.toggle.tooltip")}</p>
      </TooltipContent>
    </Tooltip>
  )
}
