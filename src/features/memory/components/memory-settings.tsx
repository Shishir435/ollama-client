import { useStorage } from "@plasmohq/storage/hook"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsCard } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { STORAGE_KEYS } from "@/lib/constants"
import { clearAllVectors, getStorageStats } from "@/lib/embeddings/vector-store"
import { Brain, Trash2 } from "@/lib/lucide-icon"

export const MemorySettings = () => {
  const { t } = useTranslation()
  const [isEnabled, setIsEnabled] = useStorage<boolean>(
    STORAGE_KEYS.MEMORY.ENABLED,
    false
  )
  const [isClearing, setIsClearing] = useState(false)
  const [stats, setStats] = useState<{
    totalVectors: number
    totalSizeMB: number
    byType: Record<string, number>
  } | null>(null)

  const handleClearMemory = async () => {
    if (!confirm(t("settings.memory.clear.confirm_dialog"))) {
      return
    }

    setIsClearing(true)
    try {
      await clearAllVectors("chat")
      alert(t("settings.memory.clear.success"))
      // Refresh stats
      loadStats()
    } catch (error) {
      console.error("Failed to clear memory:", error)
      alert(t("settings.memory.clear.error"))
    } finally {
      setIsClearing(false)
    }
  }

  const loadStats = async () => {
    try {
      const s = await getStorageStats()
      setStats(s)
    } catch (error) {
      console.error("Failed to load stats:", error)
    }
  }

  // Load stats on mount
  useState(() => {
    loadStats()
  })

  return (
    <SettingsCard
      icon={Brain}
      title={t("settings.memory.title")}
      description={t("settings.memory.description")}
      badge={t("settings.memory.beta_badge")}
      contentClassName="space-y-6">
      <div className="flex items-center justify-between space-x-2">
        <Label htmlFor="memory-toggle" className="flex flex-col space-y-1">
          <span>{t("settings.memory.enable.label")}</span>
          <span className="font-normal text-xs text-muted-foreground">
            {t("settings.memory.enable.description")}
          </span>
        </Label>
        <Switch
          id="memory-toggle"
          checked={isEnabled}
          onCheckedChange={setIsEnabled}
        />
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <div className="space-y-1">
          <Label>{t("settings.memory.clear.label")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.memory.clear.description")}
            {stats && (
              <span className="block mt-1">
                {t("settings.memory.clear.usage", {
                  count: stats.byType?.chat || 0,
                  size: stats.totalSizeMB.toFixed(2)
                })}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleClearMemory}
          disabled={isClearing}>
          <Trash2 className="size-4 mr-2" />
          {isClearing
            ? t("settings.memory.clear.button_clearing")
            : t("settings.memory.clear.button")}
        </Button>
      </div>
    </SettingsCard>
  )
}
