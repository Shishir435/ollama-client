import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  ConfirmActionDialog,
  SettingsCard,
  SettingsFormField,
  SettingsSwitch
} from "@/components/settings"
import { Button } from "@/components/ui/button"
import { useConfirmAction } from "@/hooks/use-confirm-action"
import { useToast } from "@/hooks/use-toast"
import { STORAGE_KEYS } from "@/lib/constants"
import { clearAllVectors, getStorageStats } from "@/lib/embeddings/vector-store"
import { Brain, Trash2 } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const MemorySettings = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [isEnabled, setIsEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.MEMORY.ENABLED,
      instance: plasmoGlobalStorage
    },
    true
  )
  const [isClearing, setIsClearing] = useState(false)
  const clearDialog = useConfirmAction()
  const [stats, setStats] = useState<{
    totalVectors: number
    totalSizeMB: number
    byType: Record<string, number>
  } | null>(null)

  const handleClearMemory = async () => {
    clearDialog.closeDialog()
    setIsClearing(true)
    try {
      await clearAllVectors("chat")
      toast({
        title: t("settings.memory.clear.success")
      })
      // Refresh stats
      loadStats()
    } catch (error) {
      console.error("Failed to clear memory:", error)
      toast({
        title: t("settings.memory.clear.error"),
        variant: "destructive"
      })
    } finally {
      setIsClearing(false)
    }
  }

  const loadStats = useCallback(async () => {
    try {
      const s = await getStorageStats()
      setStats(s)
    } catch (error) {
      console.error("Failed to load stats:", error)
    }
  }, [])

  // Load stats on mount
  useEffect(() => {
    loadStats()
  }, [loadStats])

  return (
    <SettingsCard
      icon={Brain}
      title={t("settings.memory.title")}
      description={t("settings.memory.description")}
      badge={t("settings.memory.beta_badge")}
      contentClassName="space-y-6">
      <SettingsSwitch
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
            }>
            {null}
          </SettingsFormField>
          <Button
            variant="destructive"
            size="sm"
            disabled={isClearing}
            onClick={clearDialog.openDialog}>
            <Trash2 className="size-4 mr-2" />
            {isClearing
              ? t("settings.memory.clear.button_clearing")
              : t("settings.memory.clear.button")}
          </Button>
          <ConfirmActionDialog
            open={clearDialog.open}
            onOpenChange={clearDialog.onOpenChange}
            title={t("settings.memory.clear.label")}
            description={t("settings.memory.clear.confirm_dialog")}
            confirmLabel={t("settings.memory.clear.button")}
            destructive
            busy={isClearing}
            onConfirm={handleClearMemory}
          />
        </div>
      </div>
    </SettingsCard>
  )
}
