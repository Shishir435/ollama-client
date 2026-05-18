import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"
import { SettingsSwitch } from "@/components/settings"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const GroundingModeSettings = () => {
  const { t } = useTranslation()
  const [groundedOnlyMode, setGroundedOnlyMode] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE,
      instance: plasmoGlobalStorage
    },
    false
  )

  return (
    <SettingsSwitch
      id="grounded-only-mode"
      label={t("settings.grounding_mode.label")}
      description={t("settings.grounding_mode.description")}
      checked={groundedOnlyMode}
      onCheckedChange={setGroundedOnlyMode}
    />
  )
}
