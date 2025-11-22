import { useStorage } from "@plasmohq/storage/hook"
import { Switch } from "@/components/ui/switch"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const SelectionButtonToggle = () => {
  const [showButton, setShowButton] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.SHOW_SELECTION_BUTTON,
      instance: plasmoGlobalStorage
    },
    true
  )

  return (
    <Switch
      id="show-selection-button"
      checked={showButton}
      onCheckedChange={setShowButton}
    />
  )
}
