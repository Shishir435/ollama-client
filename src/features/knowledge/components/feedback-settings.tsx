import { useStorage } from "@plasmohq/storage/hook"
import { Download, RotateCcw, ThumbsUp, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  SettingsCard,
  SettingsFormField,
  ToggleRow
} from "@/components/settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export function FeedbackSettings() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [config, setConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )
  const [isExporting, setIsExporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [stats, setStats] = useState({
    totalFeedback: 0,
    helpfulPercentage: 0,
    uniqueChunks: 0,
    uniqueQueries: 0
  })

  const feedbackEnabled =
    config?.feedbackEnabled ?? DEFAULT_EMBEDDING_CONFIG.feedbackEnabled
  const showChunks =
    config?.showRetrievedChunks ?? DEFAULT_EMBEDDING_CONFIG.showRetrievedChunks

  const updateConfig = useCallback(
    (updates: Partial<EmbeddingConfig>) => {
      setConfig((prev) => ({
        ...DEFAULT_EMBEDDING_CONFIG,
        ...prev,
        ...updates
      }))
    },
    [setConfig]
  )

  const loadStats = useCallback(async () => {
    try {
      setIsLoadingStats(true)
      const stats = await feedbackService.getStatistics()
      setStats(stats)
      setLastUpdated(Date.now())
    } catch (error) {
      logger.error("Failed to load feedback stats", "FeedbackSettings", {
        error
      })
    } finally {
      setIsLoadingStats(false)
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const handleFeedbackToggle = (checked: boolean) => {
    updateConfig({ feedbackEnabled: checked })
  }

  const handleShowChunksToggle = (checked: boolean) => {
    updateConfig({ showRetrievedChunks: checked })
  }

  const handleExportFeedback = async () => {
    try {
      setIsExporting(true)
      const feedback = await feedbackService.exportFeedback()
      const blob = new Blob([JSON.stringify(feedback, null, 2)], {
        type: "application/json"
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `feedback-export-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      logger.info("Exported feedback data", "FeedbackSettings", {
        count: feedback.length
      })
      toast({
        title: t("model.embedding_config.feedback_export_success")
      })
    } catch (error) {
      logger.error("Failed to export feedback", "FeedbackSettings", { error })
      toast({
        title: t("model.embedding_config.feedback_export_error"),
        variant: "destructive"
      })
    } finally {
      setIsExporting(false)
    }
  }

  const handleClearFeedback = async () => {
    try {
      setIsClearing(true)
      await feedbackService.clearAllFeedback()
      setStats({
        totalFeedback: 0,
        helpfulPercentage: 0,
        uniqueChunks: 0,
        uniqueQueries: 0
      })
      logger.info("Cleared all feedback", "FeedbackSettings")
      toast({
        title: t("model.embedding_config.feedback_clear_success")
      })
    } catch (error) {
      logger.error("Failed to clear feedback", "FeedbackSettings", { error })
      toast({
        title: t("model.embedding_config.feedback_clear_error"),
        variant: "destructive"
      })
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <SettingsCard
      icon={ThumbsUp}
      title={t("model.embedding_config.feedback_learning_title")}
      description={t("model.embedding_config.feedback_learning_description")}
      contentClassName="space-y-6">
      <ToggleRow
        id="feedback-enabled"
        label={t("model.embedding_config.feedback_enable_label")}
        description={t("model.embedding_config.feedback_enable_description")}
        checked={feedbackEnabled}
        onCheckedChange={handleFeedbackToggle}
      />

      <ToggleRow
        id="feedback-show-chunks"
        label={t("model.embedding_config.feedback_show_chunks_label")}
        description={t(
          "model.embedding_config.feedback_show_chunks_description"
        )}
        checked={showChunks}
        onCheckedChange={handleShowChunksToggle}
      />

      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">
            {t("model.embedding_config.feedback_stats_title")}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-2 px-2 text-xs"
            onClick={loadStats}
            disabled={isLoadingStats}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t("common.actions.refresh")}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">
              {t("model.embedding_config.feedback_stats_total")}
            </div>
            <div className="font-mono">{stats.totalFeedback}</div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("model.embedding_config.feedback_stats_helpful")}
            </div>
            <div className="font-mono">
              {stats.helpfulPercentage.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("model.embedding_config.feedback_stats_chunks")}
            </div>
            <div className="font-mono">{stats.uniqueChunks}</div>
          </div>
          <div>
            <div className="text-muted-foreground">
              {t("model.embedding_config.feedback_stats_queries")}
            </div>
            <div className="font-mono">{stats.uniqueQueries}</div>
          </div>
        </div>
        {lastUpdated && (
          <div className="text-[10px] text-muted-foreground">
            {t("common.updated_at")}{" "}
            {new Date(lastUpdated).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <SettingsFormField
          label={t("model.embedding_config.feedback_privacy_title")}
          description={t("model.embedding_config.feedback_privacy_note")}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportFeedback}
            disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />
            {t("model.embedding_config.feedback_export_button")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isClearing}>
                <Trash2 className="h-4 w-4 mr-2" />
                {t("model.embedding_config.feedback_clear_button")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("model.embedding_config.feedback_clear_confirm_title")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    "model.embedding_config.feedback_clear_confirm_description"
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearFeedback}>
                  {t("model.embedding_config.feedback_clear_button")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </SettingsCard>
  )
}
