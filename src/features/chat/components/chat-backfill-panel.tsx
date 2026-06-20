import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard, StatusAlert } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { getEmbeddableMessagesBySession } from "@/features/chat/utils/embedding-backfill"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { STORAGE_KEYS } from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { logger } from "@/lib/logger"
import { AlertCircle, Loader2, Sparkles } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const ChatBackfillPanel = () => {
  const { t } = useTranslation()
  const [memoryEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.MEMORY.ENABLED,
      instance: plasmoGlobalStorage
    },
    true
  )
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const { sessions } = useChatSessions()
  const { embedMessages } = useAutoEmbedMessages()

  const handleBackfill = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    setCompleted(false)

    try {
      const { messagesBySession, totalMessages } =
        await getEmbeddableMessagesBySession()

      setProgress({ current: 0, total: totalMessages })

      let processedMessages = 0
      for (const [sessionId, messages] of messagesBySession.entries()) {
        if (messages.length === 0) continue
        await embedMessages(messages, sessionId)
        processedMessages += messages.length
        setProgress({ current: processedMessages, total: totalMessages })

        // Small delay to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      setCompleted(true)
    } catch (err) {
      const errorMessage = getDisplayErrorMessage(err, "Backfill failed")
      setError(errorMessage)
      logger.error("Backfill error", "ChatBackfillPanel", { error: err })
    } finally {
      setIsRunning(false)
    }
  }, [embedMessages])

  const progressPercentage =
    progress.total > 0 ? (progress.current / progress.total) * 100 : 0

  return (
    <SettingsCard
      icon={Sparkles}
      focusId="backfill-embeddings"
      title={t("chat.backfill.title")}
      description={t("chat.backfill.description")}
      contentClassName="space-y-4">
      {error && (
        <StatusAlert
          variant="destructive"
          icon={AlertCircle}
          title={t("chat.backfill.error_label")}
          description={error}
        />
      )}

      {completed && (
        <StatusAlert
          variant="success"
          icon={Sparkles}
          title={t("chat.backfill.completed_label")}
          description={t("chat.backfill.completed_message", {
            current: progress.current,
            count: sessions.length
          })}
        />
      )}

      {isRunning && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {t("chat.backfill.processing_label", {
                current: progress.current,
                total: progress.total
              })}
            </span>
            <span>{Math.round(progressPercentage)}%</span>
          </div>
          <Progress value={progressPercentage} />
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          {t("chat.backfill.info_sessions", {
            count: sessions.length,
            sessions:
              sessions.length === 1
                ? t("chat.backfill.session_singular")
                : t("chat.backfill.session_plural")
          })}
        </p>
        <p>{t("chat.backfill.info_min_chars")}</p>
        <p>{t("chat.backfill.info_time_warning")}</p>
      </div>

      {!memoryEnabled && (
        <StatusAlert
          variant="warning"
          icon={AlertCircle}
          title="Memory is disabled"
          description="Enable memory to backfill chat history."
        />
      )}

      <Button
        onClick={handleBackfill}
        disabled={isRunning || !memoryEnabled}
        className="w-full"
        variant={completed ? "outline" : "default"}>
        {isRunning ? (
          <>
            <Loader2 className="icon-xs animate-spin" />
            {t("chat.backfill.button_processing")}
          </>
        ) : completed ? (
          <>
            <Sparkles className="icon-xs" />
            {t("chat.backfill.button_completed")}
          </>
        ) : (
          <>
            <Sparkles className="icon-xs" />
            {t("chat.backfill.button_start")}
          </>
        )}
      </Button>
    </SettingsCard>
  )
}
