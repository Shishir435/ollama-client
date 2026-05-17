import { useStorage } from "@plasmohq/storage/hook"
import { SettingsSwitch } from "@/components/settings"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const GroundingModeSettings = () => {
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
      label="Answer only from selected page context"
      description="If relevant page context is missing, the assistant returns an insufficient-context message instead of guessing."
      checked={groundedOnlyMode}
      onCheckedChange={setGroundedOnlyMode}
    />
  )
}
