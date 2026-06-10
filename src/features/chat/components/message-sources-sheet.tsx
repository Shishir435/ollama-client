import { ThumbsDown, ThumbsUp } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { IconBadge } from "@/components/icon-badge"
import { Accordion } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { logger } from "@/lib/logger"
import { cn } from "@/lib/utils"
import { AccordionCard } from "./accordion-card"
import { CopyButton } from "./copy-button"
import { PreviewSheet } from "./preview-sheet"

export interface SourceItem {
  id: string | number
  title: string
  content: string
  score: number
  chunkIndex?: number
  source?: string
  sectionPath?: string
}

export interface MessageSourcesSheetProps {
  icon: React.ReactNode
  badgeCount: number
  tooltip: string
  ariaLabel?: string
  title: string
  sections: { label?: string; items: SourceItem[] }[]
  preContent?: React.ReactNode
  renderMetadata: (item: SourceItem) => React.ReactNode
  getItemValue?: (item: SourceItem) => string
  feedback?: {
    query: string
    sessionId?: string
  }
}

export function MessageSourcesSheet({
  icon,
  badgeCount,
  tooltip,
  ariaLabel,
  title,
  sections,
  preContent,
  renderMetadata,
  getItemValue = (item) => String(item.id),
  feedback
}: MessageSourcesSheetProps) {
  const { t } = useTranslation()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [feedbackById, setFeedbackById] = useState<
    Record<string, boolean | null | undefined>
  >({})

  if (badgeCount === 0) return null

  const handleFeedback = async (itemId: string, wasHelpful: boolean) => {
    if (!feedback) return
    if (submittingFeedback) return
    setSubmittingFeedback(true)
    try {
      await feedbackService.recordFeedback(
        itemId,
        feedback.query,
        wasHelpful,
        feedback.sessionId
      )
      setFeedbackById((prev) => ({ ...prev, [itemId]: wasHelpful }))
      logger.info(`Recorded feedback for chunk ${itemId}`, "FeedbackUI", {
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
      <TooltipActionButton
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-6 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"
            onClick={() => setSheetOpen(true)}
            aria-label={ariaLabel ?? tooltip}
          />
        }
        ariaLabel={ariaLabel ?? tooltip}
        tooltip={tooltip}
        tooltipSide="top"
        icon={<IconBadge icon={icon} count={badgeCount} />}
      />
      <PreviewSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={title}
        className="w-[min(28rem,calc(100vw-1rem))]">
        <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 p-3">
            {preContent}
            {sections.map((section, i) => (
              <div key={section.label ?? i} className="space-y-1">
                {section.label && (
                  <div className="text-[11px] font-medium text-muted-foreground">
                    {section.label}
                  </div>
                )}
                <Accordion className="border-0 rounded-none divide-y-0 space-y-1">
                  {section.items.map((item) => {
                    const value = getItemValue(item)
                    const fb = feedback ? feedbackById[value] : undefined
                    return (
                      <AccordionCard
                        key={value}
                        value={value}
                        title={item.title}
                        metadata={renderMetadata(item)}
                        content={item.content}
                        footer={
                          <div className="mt-2 flex items-center gap-1">
                            {feedback && (
                              <>
                                <span className="flex-1 text-[10px] text-muted-foreground">
                                  {t("chat.sources.was_this_helpful")}
                                </span>
                                <Button
                                  size="icon"
                                  variant={fb === true ? "default" : "ghost"}
                                  className={cn(
                                    "size-6",
                                    fb === true &&
                                      "bg-status-success text-status-success-foreground hover:bg-status-success/90"
                                  )}
                                  onClick={() => handleFeedback(value, true)}
                                  disabled={submittingFeedback}
                                  aria-label={t("chat.sources.helpful_aria")}>
                                  <ThumbsUp className="icon-xs" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant={fb === false ? "default" : "ghost"}
                                  className={cn(
                                    "size-6",
                                    fb === false &&
                                      "bg-status-danger text-status-danger-foreground hover:bg-status-danger/90"
                                  )}
                                  onClick={() => handleFeedback(value, false)}
                                  disabled={submittingFeedback}
                                  aria-label={t(
                                    "chat.sources.not_helpful_aria"
                                  )}>
                                  <ThumbsDown className="icon-xs" />
                                </Button>
                              </>
                            )}
                            <CopyButton text={item.content} />
                          </div>
                        }
                      />
                    )
                  })}
                </Accordion>
              </div>
            ))}
          </div>
        </ScrollArea>
      </PreviewSheet>
    </>
  )
}
