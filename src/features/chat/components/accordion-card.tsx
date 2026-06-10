import type { ReactNode } from "react"
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion"

export interface AccordionCardProps {
  value: string
  title: string
  metadata?: ReactNode
  content: string
  footer?: ReactNode
}

export function AccordionCard({
  value,
  title,
  metadata,
  content,
  footer
}: AccordionCardProps) {
  return (
    <AccordionItem
      value={value}
      className="rounded-control border border-border/35 bg-muted/15 data-open:bg-muted/30">
      <AccordionTrigger className="px-2 py-1.5 text-xs font-medium hover:no-underline">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xs font-medium">{title}</span>
          {metadata && (
            <span className="text-[10px] text-muted-foreground">
              {metadata}
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="max-h-[min(16rem,40vh)] overflow-y-auto overflow-x-hidden">
          <div className="whitespace-pre-wrap wrap-break-word text-[11px] text-muted-foreground wrap-anywhere">
            {content}
          </div>
        </div>
        {footer}
      </AccordionContent>
    </AccordionItem>
  )
}
