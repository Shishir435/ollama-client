import { FileSearch } from "lucide-react"
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

type UsedChunk = {
  id: string | number
  title: string
  excerpt: string
  score: number
  sectionPath?: string
  source?: string
  chunkIndex?: number
}

export const UsedContextButton = ({
  chunks,
  tabContextLength,
  ragContextLength,
  tabContextTruncated
}: {
  chunks: UsedChunk[]
  tabContextLength?: number
  ragContextLength?: number
  tabContextTruncated?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const [activeChunk, setActiveChunk] = useState<UsedChunk | null>(null)

  if (!chunks || chunks.length === 0) return null

  const tabChunks = chunks.filter((chunk) => chunk.source !== "rag")
  const ragChunks = chunks.filter((chunk) => chunk.source === "rag")

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
                  aria-label={`Used context (${chunks.length})`}
                />
              }
            />
          }
          ariaLabel={`Used context (${chunks.length})`}
          tooltip="Used context"
          tooltipSide="top"
          icon={
            <div className="relative">
              <FileSearch className="icon-xs" />
              <span className="absolute -right-1 -top-1 flex size-2.5 items-center justify-center rounded-chip bg-primary text-[7px] font-bold text-primary-foreground">
                {chunks.length}
              </span>
            </div>
          }
        />
        <PopoverContent
          className="max-h-[min(28rem,calc(100vh-8rem))] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-panel p-3 scrollbar-none"
          align="start">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              Used Context ({chunks.length})
            </div>
            <div className="text-[10px] text-muted-foreground">
              tab chars: {tabContextLength || 0} | rag chars:{" "}
              {ragContextLength || 0}
              {tabContextTruncated ? " | trimmed" : ""}
            </div>

            {tabChunks.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">
                  Tab Context ({tabChunks.length})
                </div>
                {tabChunks.map((chunk) => (
                  <button
                    key={`${chunk.id}-${chunk.chunkIndex ?? 0}`}
                    type="button"
                    className="w-full min-w-0 rounded-control border bg-muted/30 p-2 text-left hover:bg-muted/60"
                    onClick={() => setActiveChunk(chunk)}>
                    <div className="truncate text-xs font-medium">
                      {chunk.title}
                    </div>
                    <div className="line-clamp-2 break-words text-[11px] text-muted-foreground">
                      {chunk.excerpt}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      score: {chunk.score.toFixed(2)}
                      {chunk.sectionPath ? ` | ${chunk.sectionPath}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {ragChunks.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-medium text-muted-foreground">
                  RAG Context ({ragChunks.length})
                </div>
                {ragChunks.map((chunk) => (
                  <button
                    key={`${chunk.id}-${chunk.chunkIndex ?? 0}`}
                    type="button"
                    className="w-full min-w-0 rounded-control border bg-muted/30 p-2 text-left hover:bg-muted/60"
                    onClick={() => setActiveChunk(chunk)}>
                    <div className="truncate text-xs font-medium">
                      {chunk.title}
                    </div>
                    <div className="line-clamp-2 break-words text-[11px] text-muted-foreground">
                      {chunk.excerpt}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      score: {chunk.score.toFixed(2)}
                      {chunk.sectionPath ? ` | ${chunk.sectionPath}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog
        open={!!activeChunk}
        onOpenChange={(v) => !v && setActiveChunk(null)}>
        <DialogContent className="max-h-[min(80vh,40rem)] w-[min(42rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-panel p-0 sm:max-w-[min(42rem,calc(100vw-2rem))]">
          <DialogHeader className="min-w-0 border-b border-border/35 px-4 py-3">
            <DialogTitle className="truncate pr-8">
              {activeChunk?.title || "Context snippet"}
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-[min(64vh,32rem)] overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {activeChunk?.excerpt}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  )
}
