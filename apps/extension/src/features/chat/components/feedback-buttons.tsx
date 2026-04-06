import { ThumbsDown, ThumbsUp } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { cn } from "@/lib/utils"

interface FeedbackButtonsProps {
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
      console.error("Failed to record feedback", e)
      // Revert on error? Or just log
    }
  }

  return (
    <TooltipProvider delay={300}>
      <div className={cn("flex items-center gap-1", className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6",
                feedback === "up"
                  ? "text-green-500 hover:text-green-600"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => handleFeedback(true)}
              disabled={feedback !== null}>
              <ThumbsUp className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("chat.feedback.helpful_tooltip")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6",
                feedback === "down"
                  ? "text-red-500 hover:text-red-600"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => handleFeedback(false)}
              disabled={feedback !== null}>
              <ThumbsDown className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("chat.feedback.not_helpful_tooltip")}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
