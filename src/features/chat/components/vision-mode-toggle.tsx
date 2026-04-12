import { useStorage } from "@plasmohq/storage/hook"
import { MonitorOff, MonitorUp } from "lucide-react"
import { useTranslation } from "react-i18next"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
// import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export const VisionModeToggle = () => {
  const { t } = useTranslation()
  const [visionModeEnabled, setVisionModeEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.AGENT.VISION_MODE_ENABLED,
      instance: plasmoGlobalStorage
    },
    false
  )

  return (
    <button
      type="button"
      onClick={() => setVisionModeEnabled(!visionModeEnabled)}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        visionModeEnabled
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "text-muted-foreground hover:bg-muted/50"
      )}
      title={
        visionModeEnabled ? "Vision Agent Mode ON" : "Vision Agent Mode OFF"
      }>
      {visionModeEnabled ? (
        <MonitorUp className="h-4 w-4" />
      ) : (
        <MonitorOff className="h-4 w-4" />
      )}
    </button>
  )
}
