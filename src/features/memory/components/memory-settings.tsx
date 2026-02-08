import { useStorage } from "@plasmohq/storage/hook"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
  SettingsCard,
  SettingsFormField,
  ToggleRow
} from "@/components/settings"
import { Button } from "@/components/ui/button"
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
      <ToggleRow
        id="memory-toggle"
        label={t("settings.memory.enable.label")}
        description={t("settings.memory.enable.description")}
        checked={isEnabled}
        onCheckedChange={setIsEnabled}
      />

      <div className="border-t pt-4">
        <div className="flex items-center justify-between">
          <SettingsFormField
            label={t("settings.memory.clear.label")}
            description={
              <>
                {t("settings.memory.clear.description")}
                {stats && (
                  <span className="block mt-1">
                    {t("settings.memory.clear.usage", {
                      count: stats.byType?.chat || 0,
                      size: stats.totalSizeMB.toFixed(2)
                    })}
                  </span>
                )}
              </>
            }
          />
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
      </div>
    </SettingsCard>
  )
}
