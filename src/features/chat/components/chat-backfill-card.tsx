import { AlertCircle, Loader2, Sparkles } from "lucide-react"
import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard, StatusAlert } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useSetting } from "@/hooks/use-setting"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { logger } from "@/lib/logger"
import { SETTINGS } from "@/lib/storage/settings"
import { requestMessageIndexing } from "@/protocol/embedding-client"

export const ChatBackfillCard = () => {
  const { t } = useTranslation()
  const [memoryEnabled] = useSetting(SETTINGS.MEMORY_ENABLED)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const { sessions } = useChatSessions(false)

  const handleBackfill = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    setCompleted(false)

    try {
      await requestMessageIndexing([], { rebuild: true })

      setCompleted(true)
    } catch (err) {
      const errorMessage = getDisplayErrorMessage(err, "Backfill failed")
      setError(errorMessage)
      logger.error("Backfill error", "ChatBackfillCard", { error: err })
    } finally {
      setIsRunning(false)
    }
  }, [])

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
          title={t("chat.backfill.queued_label")}
          description={t("chat.backfill.queued_message")}
        />
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
            {t("chat.backfill.queued_label")}
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
