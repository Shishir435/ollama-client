import { useState } from "react"
import { TooltipActionButton } from "@/components/actions"
import { IconBadge } from "@/components/icon-badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { ChunkFeedbackButton } from "./chunk-feedback-button"
import { CopyButton } from "./copy-button"
import { PreviewSheet } from "./preview-sheet"

export interface SourceItem {
  id: string | number
  /** Real chunk vector id for feedback — `id` may be a compound React key. */
  chunkId?: string | number
  title: string
  content: string
  score: number
  chunkIndex?: number
  source?: string
  sectionPath?: string
  kind?: "page" | "knowledge" | "web"
  url?: string
  engine?: string
  publishedAt?: string
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
  metadataPosition?: "before-title" | "after-title"
  /** Override the expanded body. Defaults to the item's plain-text content. */
  renderContent?: (item: SourceItem) => React.ReactNode
  getItemValue?: (item: SourceItem) => string
  feedback?: {
    query: string
    sessionId?: string
    isEnabled?: (item: SourceItem) => boolean
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
  metadataPosition = "after-title",
  renderContent,
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
          <div className="space-y-4 px-2.5 py-3">
            {preContent}
            {sections.map((section, i) => (
              <div key={section.label ?? i} className="space-y-1.5">
                {section.label && (
                  <div className="flex items-center justify-between gap-1 px-0.5">
                    <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </span>
                    <CopyButton
                      text={section.items.map((i) => i.content).join("\n\n")}
                    />
                  </div>
                )}
                <Accordion className="divide-y divide-border/30 overflow-hidden rounded-control border border-border/40">
                  {section.items.map((item) => {
                    const value = getItemValue(item)
                    const meta = renderMetadata(item)
                    return (
                      <AccordionItem
                        key={value}
                        value={value}
                        className="relative rounded-none border-0 bg-transparent data-open:bg-muted/20">
                        <AccordionTrigger className="min-w-0 px-2.5 py-2 pr-14 text-xs font-medium hover:no-underline">
                          <div className="flex min-w-0 flex-1 overflow-hidden flex-col gap-0.5">
                            {meta && metadataPosition === "before-title" && (
                              <span className="block min-w-0 max-w-full truncate text-micro text-muted-foreground">
                                {meta}
                              </span>
                            )}
                            <span className="truncate text-xs font-medium">
                              {item.title}
                            </span>
                            {meta && metadataPosition === "after-title" && (
                              <span className="block min-w-0 max-w-full truncate text-micro text-muted-foreground">
                                {meta}
                              </span>
                            )}
                          </div>
                        </AccordionTrigger>
                        <div className="absolute right-7 top-2">
                          <CopyButton text={item.content} />
                        </div>
                        <AccordionContent>
                          <div className="space-y-2 px-2.5 pb-2.5">
                            <div className="max-h-[min(16rem,40vh)] overflow-y-auto overflow-x-hidden">
                              {renderContent ? (
                                renderContent(item)
                              ) : (
                                <div className="whitespace-pre-wrap text-2xs text-muted-foreground wrap-anywhere">
                                  {item.content}
                                </div>
                              )}
                            </div>
                            {feedback &&
                              (feedback.isEnabled?.(item) ?? true) && (
                                <div className="flex items-center gap-1">
                                  <ChunkFeedbackButton
                                    chunkId={value}
                                    query={feedback.query}
                                    sessionId={feedback.sessionId}
                                  />
                                </div>
                              )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
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
