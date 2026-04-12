import { useStorage } from "@plasmohq/storage/hook"
import { Repeat } from "lucide-react"
import { useTranslation } from "react-i18next"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"

export const AutoRepeatToggle = () => {
  const { t } = useTranslation()
  const [autoRepeatEnabled, setAutoRepeatEnabled] = useStorage<boolean>(
    {
      key: "agent-auto-repeat-enabled", // We'll add this to STORAGE_KEYS.AGENT if needed, using string literal for speed
      instance: plasmoGlobalStorage
    },
    false
  )

  return (
    <button
      type="button"
      onClick={() => setAutoRepeatEnabled(!autoRepeatEnabled)}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        autoRepeatEnabled
          ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
          : "text-muted-foreground hover:bg-muted/50"
      )}
      title={
        autoRepeatEnabled
          ? "Auto-Repeat Agent Task ON"
          : "Auto-Repeat Agent Task OFF"
      }>
      <Repeat className="h-4 w-4" />
    </button>
  )
}
