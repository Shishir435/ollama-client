import type { ReactNode } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

interface PreviewSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  meta?: ReactNode
  children: ReactNode
  className?: string
}

export function PreviewSheet({
  open,
  onOpenChange,
  title,
  meta,
  children,
  className
}: PreviewSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-[min(42rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] p-0",
          className
        )}>
        <SheetHeader className="min-w-0 border-b border-border/35 px-4 py-3">
          <SheetTitle className="truncate pr-8">{title}</SheetTitle>
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}

interface PreviewTextBlockProps {
  text: string
  emptyText: string
  className?: string
}

export function PreviewTextBlock({
  text,
  emptyText,
  className
}: PreviewTextBlockProps) {
  return (
    <pre
      className={cn(
        "whitespace-pre-wrap wrap-break-word p-4 font-sans text-xs leading-relaxed text-muted-foreground",
        className
      )}>
      {text || emptyText}
    </pre>
  )
}
