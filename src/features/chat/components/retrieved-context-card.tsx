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
}

export function RetrievedContextCard({
  chunk,
  query,
  index,
  sessionId
}: RetrievedContextCardProps) {
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleFeedback = async (wasHelpful: boolean) => {
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

  return (
    <Card className="mb-2 border-l-4 border-l-primary/50">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm truncate">{chunk.title}</CardTitle>
            <CardDescription className="text-xs flex items-center gap-2">
              <span>
                Relevance:{" "}
                <span className="font-mono">
                  {(chunk.score * 100).toFixed(0)}%
                </span>
              </span>
              {chunk.chunkIndex !== undefined && (
                <span className="text-muted-foreground">
                  • Chunk {chunk.chunkIndex + 1}
                </span>
              )}
            </CardDescription>
          </div>

          {/* Feedback Buttons */}
          <div className="flex gap-1 shrink-0">
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
        </div>
      </CardHeader>
      <CardContent className="text-xs pt-2">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="line-clamp-3 text-muted-foreground whitespace-pre-wrap">
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
}

export function RetrievedContextList({
  chunks,
  query,
  sessionId
}: RetrievedContextListProps) {
  if (chunks.length === 0) {
    return null
  }

  return (
    <div className="space-y-2 mb-4">
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
        />
      ))}
    </div>
  )
}
