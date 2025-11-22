import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MiniBadge } from "@/components/ui/mini-badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type ChatSearchResult,
  useSemanticChatSearch
} from "@/features/chat/hooks/use-semantic-chat-search"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useDebounce } from "@/hooks/use-debounce"
import {
  Bot,
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  Search,
  User
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface SemanticChatSearchDialogProps {
  open: boolean
  onClose: () => void
  onSelectResult?: (result: ChatSearchResult) => void
  currentSessionId?: string | null
}

export const SemanticChatSearchDialog = ({
  open,
  onClose,
  onSelectResult,
  currentSessionId
}: SemanticChatSearchDialogProps) => {
  const [searchQuery, setSearchQuery] = useState("")
  const [results, setResults] = useState<ChatSearchResult[]>([])
  const [searchScope, setSearchScope] = useState<"all" | "current">("all")
  const debouncedQuery = useDebounce(searchQuery, 500)
  const { search, isSearching, error } = useSemanticChatSearch()
  const { sessions, setCurrentSessionId, setHighlightedMessage } =
    useChatSessions()
  // Track current search to cancel if query changes
  const currentSearchRef = useRef<Promise<ChatSearchResult[]> | null>(null)

  // Group results by session
  const groupedResults = useMemo(() => {
    const grouped = new Map<string, ChatSearchResult[]>()

    results.forEach((result) => {
      const sessionId = result.sessionId
      if (!grouped.has(sessionId)) {
        grouped.set(sessionId, [])
      }
      const sessionResults = grouped.get(sessionId)
      if (sessionResults) {
        sessionResults.push(result)
      }
    })

    return Array.from(grouped.entries()).map(([sessionId, sessionResults]) => {
      const session = sessions.find((s) => s.id === sessionId)
      return {
        sessionId,
        sessionTitle: session?.title || "Unknown Session",
        results: sessionResults.sort(
          (a, b) => b.result.similarity - a.result.similarity
        )
      }
    })
  }, [results, sessions])

  useEffect(() => {
    // Clear previous results if query is empty
    if (!debouncedQuery.trim()) {
      setResults([])
      currentSearchRef.current = null
      return
    }

    // Start new search
    const searchPromise = search(debouncedQuery.trim(), {
      sessionId:
        searchScope === "current" && currentSessionId
          ? currentSessionId
          : undefined
    })

    currentSearchRef.current = searchPromise

    // Handle search completion
    searchPromise
      .then((searchResults) => {
        // Only update if this is still the current search
        if (currentSearchRef.current === searchPromise) {
          setResults(searchResults)
        }
      })
      .catch((err) => {
        // Only log error if this is still the current search
        if (currentSearchRef.current === searchPromise) {
          console.error("Search error:", err)
        }
      })

    // Cleanup: mark search as cancelled if component unmounts or query changes
    return () => {
      currentSearchRef.current = null
    }
  }, [debouncedQuery, search, searchScope, currentSessionId])

  const handleSelectResult = useCallback(
    (result: ChatSearchResult) => {
      // Switch to the session if it's not the current one
      if (result.sessionId !== currentSessionId) {
        setCurrentSessionId(result.sessionId)
      }

      // Set the highlighted message to trigger scrolling
      setHighlightedMessage({
        role: result.role,
        content: result.messageContent
      })

      if (onSelectResult) {
        onSelectResult(result)
      }

      onClose()
    },
    [
      currentSessionId,
      onSelectResult,
      onClose,
      setCurrentSessionId,
      setHighlightedMessage
    ]
  )

  const formatTimestamp = useCallback((timestamp: number) => {
    try {
      const date = new Date(timestamp)
      const now = Date.now()
      const diffMs = now - timestamp
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return "Just now"
      if (diffMins < 60)
        return `${diffMins} ${diffMins === 1 ? "minute" : "minutes"} ago`
      if (diffHours < 24)
        return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`
      if (diffDays < 7)
        return `${diffDays} ${diffDays === 1 ? "day" : "days"} ago`

      return date.toLocaleDateString()
    } catch {
      return "Unknown time"
    }
  }, [])

  const truncateText = useCallback((text: string, maxLength: number = 150) => {
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}...`
  }, [])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2">
            <DialogTitle>Semantic Chat Search</DialogTitle>
            <MiniBadge text="Beta v0.3.0" />
          </div>
          <DialogDescription>
            Search your chat history by meaning, not just keywords
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-4 space-y-3">
          {currentSessionId && (
            <Tabs
              value={searchScope}
              onValueChange={(value) =>
                setSearchScope(value as "all" | "current")
              }
              className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="all">All Chats</TabsTrigger>
                <TabsTrigger value="current">Current Chat</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations by meaning..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              autoFocus
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          {error && (
            <div className="mt-2 text-sm text-destructive">{error}</div>
          )}
        </div>

        <ScrollArea className="flex-1 px-6 pb-6">
          {isSearching ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-2" />
              <p className="text-sm">Searching chat history...</p>
            </div>
          ) : (
            <>
              {debouncedQuery.trim() && results.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No results found. Try a different search query.
                </div>
              )}

              {!debouncedQuery.trim() && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Start typing to search your chat history semantically...
                </div>
              )}

              {groupedResults.length > 0 && (
                <div className="space-y-4">
                  {groupedResults.map(
                    ({ sessionId, sessionTitle, results: sessionResults }) => (
                      <div key={sessionId} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {sessionTitle}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {sessionResults.length}{" "}
                            {sessionResults.length === 1 ? "result" : "results"}
                          </Badge>
                        </div>

                        <div className="space-y-2 pl-6">
                          {sessionResults.map((result) => (
                            <button
                              key={`${result.sessionId}-${result.timestamp}-${result.result.document.id}`}
                              type="button"
                              className={cn(
                                "group relative w-full rounded-lg border border-border bg-card p-3 text-left",
                                "hover:bg-accent hover:border-accent-foreground/20",
                                "transition-colors cursor-pointer"
                              )}
                              onClick={() => handleSelectResult(result)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault()
                                  handleSelectResult(result)
                                }
                              }}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    {result.role === "user" ? (
                                      <User className="h-3 w-3 text-muted-foreground" />
                                    ) : (
                                      <Bot className="h-3 w-3 text-muted-foreground" />
                                    )}
                                    <Badge
                                      variant={
                                        result.role === "user"
                                          ? "default"
                                          : "secondary"
                                      }
                                      className="text-xs">
                                      {result.role === "user"
                                        ? "You"
                                        : "Assistant"}
                                    </Badge>
                                    <Badge
                                      variant="outline"
                                      className="text-xs">
                                      {Math.round(
                                        result.result.similarity * 100
                                      )}
                                      % match
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-foreground line-clamp-3">
                                    {truncateText(result.messageContent)}
                                  </p>
                                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    {formatTimestamp(result.timestamp)}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleSelectResult(result)
                                  }}>
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
