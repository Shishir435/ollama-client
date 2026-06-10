import { ThumbsDown, ThumbsUp } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { type ActionConfig, ActionGroup } from "@/components/actions"
import { TooltipProvider } from "@/components/ui/tooltip"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"

export interface FeedbackButtonsProps {
  sources?: Array<{
    id?: number | string
    score?: number
    title?: string
  }>
  query?: string
  className?: string
}

export const FeedbackButtons = ({
  sources,
  query,
  className
}: FeedbackButtonsProps) => {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null)

  // If no sources with IDs, we can't record specific feedback
  if (!sources || sources.length === 0 || !query) return null

  const handleFeedback = async (isHelpful: boolean) => {
    // Optimistic UI update
    setFeedback(isHelpful ? "up" : "down")

    try {
      // Record feedback for all chunks used in this response
      // Ideally we'd let users rate individual chunks, but message-level feedback is a good start
      const promises = sources
        .filter((s) => s.id) // Only sources with IDs
        .map((s) =>
          feedbackService.recordFeedback(String(s.id), query, isHelpful)
        )

      await Promise.all(promises)
    } catch (e) {
      logger.error("Failed to record feedback", "FeedbackButtons", { error: e })
      // Revert on error? Or just log
    }
  }
  const feedbackActions: ActionConfig[] = [
    {
      key: "helpful",
      className: cn(
        "size-6",
        feedback === "up"
          ? "text-status-success hover:text-status-success/80"
          : "text-muted-foreground hover:text-foreground"
      ),
      onClick: () => handleFeedback(true),
      disabled: feedback !== null,
      label: t("chat.feedback.helpful_tooltip"),
      icon: <ThumbsUp className="icon-sm" />
    },
    {
      key: "not-helpful",
      className: cn(
        "size-6",
        feedback === "down"
          ? "text-status-danger hover:text-status-danger/80"
          : "text-muted-foreground hover:text-foreground"
      ),
      onClick: () => handleFeedback(false),
      disabled: feedback !== null,
      label: t("chat.feedback.not_helpful_tooltip"),
      icon: <ThumbsDown className="icon-sm" />
    }
  ]

  return (
    <TooltipProvider delay={300}>
      <ActionGroup actions={feedbackActions} className={className} />
    </TooltipProvider>
  )
}
