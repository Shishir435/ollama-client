import { Info, ThumbsDown, ThumbsUp } from "lucide-react"
import { useState } from "react"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import type { RetrievedChunk } from "@/features/chat/components/retrieved-context-card"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"

export interface RAGSourcesButtonProps {
  sources: RetrievedChunk[]
  query?: string
  sessionId?: string
  enableFeedback?: boolean
}

export function RAGSourcesButton({
  sources,
  query,
  sessionId,
  enableFeedback = true
}: RAGSourcesButtonProps) {
  const [open, setOpen] = useState(false)
  const [activeSource, setActiveSource] = useState<RetrievedChunk | null>(null)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [feedbackById, setFeedbackById] = useState<
    Record<string, boolean | null | undefined>
  >({})

  if (!sources || sources.length === 0) {
    return null
  }

  const handleFeedback = async (
    source: RetrievedChunk,
    wasHelpful: boolean
  ) => {
    if (!enableFeedback) return
    if (submittingFeedback) return
    setSubmittingFeedback(true)
    try {
      await feedbackService.recordFeedback(
        String(source.id),
        query || "",
        wasHelpful,
        sessionId
      )
      setFeedbackById((prev) => ({
        ...prev,
        [String(source.id)]: wasHelpful
      }))
      logger.info(`Recorded feedback for chunk ${source.id}`, "FeedbackUI", {
        wasHelpful
      })
    } catch (error) {
      logger.error("Failed to record feedback", "FeedbackUI", { error })
    } finally {
      setSubmittingFeedback(false)
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipActionButton
          trigger={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                  aria-label={`View ${sources.length} retrieved source${
                    sources.length > 1 ? "s" : ""
                  }`}
                />
              }
            />
          }
          ariaLabel={`View ${sources.length} retrieved source${
            sources.length > 1 ? "s" : ""
          }`}
          tooltip={`${sources.length} RAG source${
            sources.length > 1 ? "s" : ""
          }`}
          tooltipSide="top"
          tooltipSideOffset={6}
          icon={
            <div className="relative">
              <Info className="size-3" />
              <span className="absolute -right-1 -top-1 flex size-2.5 items-center justify-center rounded-chip bg-primary text-[7px] font-bold text-primary-foreground">
                {sources.length}
              </span>
            </div>
          }
        />
        <PopoverContent
          className="w-96 max-h-115 overflow-y-auto scrollbar-none p-3"
          align="start">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              Retrieved Sources ({sources.length})
            </div>
            {sources.map((source) => {
              const relevance = Math.max(
                0,
                Math.min(100, Math.round(source.score * 100))
              )
              const title = source.title?.trim() || source.source || "Source"
              const feedback = feedbackById[String(source.id)]
              return (
                <div
                  key={source.id}
                  className="w-full rounded border bg-muted/30 p-2 text-left hover:bg-muted/60">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setActiveSource(source)}>
                      <div className="truncate text-xs font-medium">
                        {title}
                      </div>
                    </button>
                    {enableFeedback && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant={feedback === true ? "default" : "ghost"}
                          className={cn(
                            "size-6",
                            feedback === true &&
                              "bg-status-success text-status-success-foreground hover:bg-status-success/90"
                          )}
                          onClick={() => handleFeedback(source, true)}
                          disabled={submittingFeedback}
                          aria-label="Helpful">
                          <ThumbsUp className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant={feedback === false ? "default" : "ghost"}
                          className={cn(
                            "size-6",
                            feedback === false &&
                              "bg-status-danger text-status-danger-foreground hover:bg-status-danger/90"
                          )}
                          onClick={() => handleFeedback(source, false)}
                          disabled={submittingFeedback}
                          aria-label="Not helpful">
                          <ThumbsDown className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="line-clamp-2 text-[11px] text-muted-foreground">
                    {source.content}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    score: {source.score.toFixed(2)} | {relevance}%
                    {source.chunkIndex !== undefined
                      ? ` | #${source.chunkIndex + 1}`
                      : ""}
                    {source.source ? ` | ${source.source}` : ""}
                  </div>
                </div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog
        open={!!activeSource}
        onOpenChange={(v) => !v && setActiveSource(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {activeSource?.title || "Retrieved source"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {activeSource && (
              <div className="text-xs text-muted-foreground">
                score: {activeSource.score.toFixed(2)}
                {activeSource.chunkIndex !== undefined
                  ? ` | chunk #${activeSource.chunkIndex + 1}`
                  : ""}
                {activeSource.source ? ` | ${activeSource.source}` : ""}
              </div>
            )}
            <pre className="max-h-[52vh] overflow-auto scrollbar-none whitespace-pre-wrap rounded border bg-muted/20 p-3 text-xs leading-relaxed">
              {activeSource?.content}
            </pre>
            {enableFeedback && activeSource && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={
                    feedbackById[String(activeSource.id)] === true
                      ? "default"
                      : "outline"
                  }
                  className={cn(
                    feedbackById[String(activeSource.id)] === true &&
                      "bg-status-success text-status-success-foreground hover:bg-status-success/90"
                  )}
                  onClick={() => handleFeedback(activeSource, true)}
                  disabled={submittingFeedback}>
                  <ThumbsUp className="mr-1 size-4" />
                  Helpful
                </Button>
                <Button
                  size="sm"
                  variant={
                    feedbackById[String(activeSource.id)] === false
                      ? "default"
                      : "outline"
                  }
                  className={cn(
                    feedbackById[String(activeSource.id)] === false &&
                      "bg-status-danger text-status-danger-foreground hover:bg-status-danger/90"
                  )}
                  onClick={() => handleFeedback(activeSource, false)}
                  disabled={submittingFeedback}>
                  <ThumbsDown className="mr-1 size-4" />
                  Not helpful
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
