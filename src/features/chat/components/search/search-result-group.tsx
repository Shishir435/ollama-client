import { Badge } from "@/components/ui/badge"
import type { ChatSearchResult } from "@/features/chat/hooks/use-semantic-chat-search"
import { MessageSquare } from "@/lib/lucide-icon"
import { SearchResultItem } from "./search-result-item"

interface SearchResultGroupProps {
  sessionId: string
  sessionTitle: string
  results: ChatSearchResult[]
  onSelectResult: (result: ChatSearchResult) => void
}

export const SearchResultGroup = ({
  sessionId,
  sessionTitle,
  results,
  onSelectResult
}: SearchResultGroupProps) => {
  return (
    <div key={sessionId} className="space-y-3">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-md py-2 flex items-center gap-2 border-b shadow-sm -mx-3 px-3">
        <div className="bg-primary/10 p-1 rounded-md">
          <MessageSquare className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-sm font-semibold truncate flex-1 tracking-tight">
          {sessionTitle}
        </span>
        <Badge
          variant="secondary"
          className="text-[10px] h-5 px-1.5 rounded-full">
          {results.length}
        </Badge>
      </div>

      <div className="space-y-2.5">
        {results.map((result) => (
          <SearchResultItem
            key={`${result.sessionId}-${result.timestamp}-${result.result.document.id}`}
            result={result}
            onClick={onSelectResult}
          />
        ))}
      </div>
    </div>
  )
}
