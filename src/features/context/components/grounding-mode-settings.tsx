import { useTranslation } from "react-i18next"
import { SettingsSwitch } from "@/components/settings"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"

export const GroundingModeSettings = () => {
  const { t } = useTranslation()
  const [groundedOnlyMode, setGroundedOnlyMode] = useSetting(
    SETTINGS.GROUNDED_ONLY_MODE
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
