import { ThumbsDown, ThumbsUp } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"

interface ChunkFeedbackButtonProps {
  chunkId: string
  query: string
  sessionId?: string
}

export function ChunkFeedbackButton({
  chunkId,
  query,
  sessionId
}: ChunkFeedbackButtonProps) {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<boolean | null | undefined>(
    undefined
  )

  const handleFeedback = async (wasHelpful: boolean) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await feedbackService.recordFeedback(
        chunkId,
        query,
        wasHelpful,
        sessionId
      )
      setFeedback(wasHelpful)
      logger.info(`Recorded feedback for chunk ${chunkId}`, "FeedbackUI", {
        wasHelpful
      })
    } catch (error) {
      logger.error("Failed to record feedback", "FeedbackUI", { error })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <span className="flex-1 text-micro text-muted-foreground">
        {t("chat.sources.was_this_helpful")}
      </span>
      <TooltipActionButton
        size="icon"
        variant={feedback === true ? "default" : "ghost"}
        className={cn(
          "size-6",
          feedback === true &&
            "bg-status-success text-status-success-foreground hover:bg-status-success/90"
        )}
        onClick={() => handleFeedback(true)}
        disabled={submitting}
        label={t("chat.sources.helpful_aria")}
        icon={<ThumbsUp className="icon-xs" />}
      />
      <TooltipActionButton
        size="icon"
        variant={feedback === false ? "default" : "ghost"}
        className={cn(
          "size-6",
          feedback === false &&
            "bg-status-danger text-status-danger-foreground hover:bg-status-danger/90"
        )}
        onClick={() => handleFeedback(false)}
        disabled={submitting}
        label={t("chat.sources.not_helpful_aria")}
        icon={<ThumbsDown className="icon-xs" />}
      />
    </>
  )
}
