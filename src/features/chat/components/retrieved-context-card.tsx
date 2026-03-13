import { ThumbsDown, ThumbsUp } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"

export interface RetrievedChunk {
  id: string | number
  title: string
  content: string
  score: number
  source?: string
  chunkIndex?: number
}

interface RetrievedContextCardProps {
  chunk: RetrievedChunk
  query: string
  index: number
  sessionId?: string
  enableFeedback?: boolean
}

export function RetrievedContextCard({
  chunk,
  query,
  sessionId,
  enableFeedback = true
}: RetrievedContextCardProps) {
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleFeedback = async (wasHelpful: boolean) => {
    if (!enableFeedback) return
    if (isSubmitting) return

    setIsSubmitting(true)

    try {
      await feedbackService.recordFeedback(
        String(chunk.id),
        query,
        wasHelpful,
        sessionId
      )

      setFeedback(wasHelpful)

      logger.info(`Recorded feedback for chunk ${chunk.id}`, "FeedbackUI", {
        wasHelpful,
        query: query.substring(0, 20)
      })
    } catch (error) {
      logger.error("Failed to record feedback", "FeedbackUI", { error })
    } finally {
      setIsSubmitting(false)
    }
  }

  const relevance = Math.max(0, Math.min(100, Math.round(chunk.score * 100)))
  const title = chunk.title?.trim() || chunk.source || "Source"

  return (
    <Card
      size="sm"
      className="mb-1.5 gap-2 border border-muted/40 bg-muted/10 py-2 shadow-sm transition hover:border-muted/60 hover:bg-muted/20">
      <CardHeader className="px-3 py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-xs font-medium">
              {title}
            </CardTitle>
            <CardDescription className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono">{relevance}%</span>
              </span>
              {chunk.chunkIndex !== undefined && (
                <span>• #{chunk.chunkIndex + 1}</span>
              )}
              {chunk.source && (
                <span className="truncate">• {chunk.source}</span>
              )}
            </CardDescription>
          </div>

          {/* Feedback Buttons */}
          {enableFeedback && (
            <div className="flex shrink-0 gap-1">
              <Button
                size="icon"
                variant={feedback === true ? "default" : "ghost"}
                className={cn(
                  "h-7 w-7",
                  feedback === true &&
                    "bg-green-500 hover:bg-green-600 text-white"
                )}
                onClick={() => handleFeedback(true)}
                disabled={isSubmitting}
                title="This was helpful">
                <ThumbsUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={feedback === false ? "default" : "ghost"}
                className={cn(
                  "h-7 w-7",
                  feedback === false && "bg-red-500 hover:bg-red-600 text-white"
                )}
                onClick={() => handleFeedback(false)}
                disabled={isSubmitting}
                title="This was not helpful">
                <ThumbsDown className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-1 pt-0 text-xs">
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <p className="mt-0 mb-0 line-clamp-3 whitespace-pre-wrap text-muted-foreground leading-snug">
            {chunk.content}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

interface RetrievedContextListProps {
  chunks: RetrievedChunk[]
  query: string
  sessionId?: string
  enableFeedback?: boolean
}

export function RetrievedContextList({
  chunks,
  query,
  sessionId,
  enableFeedback = true
}: RetrievedContextListProps) {
  if (chunks.length === 0) {
    return null
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">
        Retrieved Context ({chunks.length})
      </div>
      {chunks.map((chunk, index) => (
        <RetrievedContextCard
          key={chunk.id}
          chunk={chunk}
          query={query}
          index={index}
          sessionId={sessionId}
          enableFeedback={enableFeedback}
        />
      ))}
    </div>
  )
}
