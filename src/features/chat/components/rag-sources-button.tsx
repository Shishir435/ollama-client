import { Info } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  type RetrievedChunk,
  RetrievedContextCard
} from "@/features/chat/components/retrieved-context-card"

interface RAGSourcesButtonProps {
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

  if (!sources || sources.length === 0) {
    return null
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title={`${sources.length} RAG source${sources.length > 1 ? "s" : ""}`}>
          <div className="relative">
            <Info className="h-3.5 w-3.5" />
            <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
              {sources.length}
            </span>
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 max-h-[400px] overflow-y-auto"
        align="start">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground mb-2">
            Retrieved Sources ({sources.length})
          </div>
          {sources.map((chunk, index) => (
            <RetrievedContextCard
              key={chunk.id}
              chunk={chunk}
              query={query || ""}
              index={index}
              sessionId={sessionId}
              enableFeedback={enableFeedback}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
