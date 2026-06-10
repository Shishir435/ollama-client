import { useState } from "react"
import { TooltipActionButton } from "@/components/actions"
import { IconBadge } from "@/components/icon-badge"
import { Accordion } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { AccordionCard } from "./accordion-card"
import { ChunkFeedbackButton } from "./chunk-feedback-button"
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
  const [sheetOpen, setSheetOpen] = useState(false)

  if (badgeCount === 0) return null

  return (
    <>
      <TooltipActionButton
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className={chatIconBtnCls}
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
                              <ChunkFeedbackButton
                                chunkId={value}
                                query={feedback.query}
                                sessionId={feedback.sessionId}
                              />
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
