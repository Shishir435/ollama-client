import { Download, InfoIcon, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsSwitch } from "@/components/settings"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { STORAGE_KEYS } from "@/lib/constants"
import { getEmbeddingConfig } from "@/lib/embeddings/config"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export function FeedbackSettings() {
  const { t } = useTranslation()
  const [feedbackEnabled, setFeedbackEnabled] = useState(true)
  const [showChunks, setShowChunks] = useState(true)
  const [stats, setStats] = useState({
    totalFeedback: 0,
    helpfulPercentage: 0,
    uniqueChunks: 0,
    uniqueQueries: 0
  })

  // Load config and stats
  useEffect(() => {
    async function loadSettings() {
      const config = await getEmbeddingConfig()
      setFeedbackEnabled(config.feedbackEnabled ?? true)
      setShowChunks(config.showRetrievedChunks ?? true)

      const stats = await feedbackService.getStatistics()
      setStats(stats)
    }
    loadSettings()
  }, [])

  const handleFeedbackToggle = async (checked: boolean) => {
    setFeedbackEnabled(checked)
    const config = await getEmbeddingConfig()
    await plasmoGlobalStorage.set(STORAGE_KEYS.EMBEDDINGS.CONFIG, {
      ...config,
      feedbackEnabled: checked
    })
  }

  const handleShowChunksToggle = async (checked: boolean) => {
    setShowChunks(checked)
    const config = await getEmbeddingConfig()
    await plasmoGlobalStorage.set(STORAGE_KEYS.EMBEDDINGS.CONFIG, {
      ...config,
      showRetrievedChunks: checked
    })
  }

  const handleExportFeedback = async () => {
    try {
      const feedback = await feedbackService.exportFeedback()
      const blob = new Blob([JSON.stringify(feedback, null, 2)], {
        type: "application/json"
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `feedback-export-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)

      logger.info("Exported feedback data", "FeedbackSettings", {
        count: feedback.length
      })
    } catch (error) {
      logger.error("Failed to export feedback", "FeedbackSettings", { error })
    }
  }

  const handleClearFeedback = async () => {
    if (
      !confirm(
        "Are you sure you want to clear all feedback? This cannot be undone."
      )
    ) {
      return
    }

    try {
      await feedbackService.clearAllFeedback()
      setStats({
        totalFeedback: 0,
        helpfulPercentage: 0,
        uniqueChunks: 0,
        uniqueQueries: 0
      })
      logger.info("Cleared all feedback", "FeedbackSettings")
    } catch (error) {
      logger.error("Failed to clear feedback", "FeedbackSettings", { error })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("model.embedding_config.feedback_learning_title")}
        </CardTitle>
        <CardDescription>
          {t("model.embedding_config.feedback_learning_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingsSwitch
          label={t("model.embedding_config.feedback_enable_label")}
          description={t("model.embedding_config.feedback_enable_description")}
          checked={feedbackEnabled}
          onCheckedChange={handleFeedbackToggle}
        />

        <SettingsSwitch
          label={t("model.embedding_config.feedback_show_chunks_label")}
          description={t(
            "model.embedding_config.feedback_show_chunks_description"
          )}
          checked={showChunks}
          onCheckedChange={handleShowChunksToggle}
        />

        <Separator />

        {/* Statistics */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Feedback Statistics</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Total Feedback</div>
              <div className="font-mono">{stats.totalFeedback}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Helpful Rate</div>
              <div className="font-mono">
                {stats.helpfulPercentage.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Unique Chunks</div>
              <div className="font-mono">{stats.uniqueChunks}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Unique Queries</div>
              <div className="font-mono">{stats.uniqueQueries}</div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Privacy Controls */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Privacy Controls</div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportFeedback}
              className="flex-1">
              <Download className="h-4 w-4 mr-2" />
              {t("model.embedding_config.feedback_export_button")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearFeedback}
              className="flex-1">
              <Trash2 className="h-4 w-4 mr-2" />
              {t("model.embedding_config.feedback_clear_button")}
            </Button>
          </div>

          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {t("model.embedding_config.feedback_privacy_note")}
            </AlertDescription>
          </Alert>
        </div>
      </CardContent>
    </Card>
  )
}
