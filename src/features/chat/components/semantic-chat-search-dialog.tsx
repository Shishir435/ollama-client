import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MiniBadge } from "@/components/ui/mini-badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  type ChatSearchResult,
  useSemanticChatSearch
} from "@/features/chat/hooks/use-semantic-chat-search"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useDebounce } from "@/hooks/use-debounce"
import {
  Clock,
  ExternalLink,
  Loader2,
  MessageSquare,
  Search
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
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const [results, setResults] = useState<ChatSearchResult[]>([])
  const [searchScope, setSearchScope] = useState<"all" | "current">("all")
  const debouncedQuery = useDebounce(searchQuery, 500)
  const { search, isSearching, error } = useSemanticChatSearch()
  const {
    sessions,
    setCurrentSessionId,
    setHighlightedMessage,
    ensureMessageLoaded
  } = useChatSessions()
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

    return Array.from(grouped.entries()).reduce<
      {
        sessionId: string
        sessionTitle: string
        results: ChatSearchResult[]
      }[]
    >((acc, [sessionId, sessionResults]) => {
      const session = sessions.find((s) => s.id === sessionId)
      if (session) {
        acc.push({
          sessionId,
          sessionTitle: session.title,
          results: sessionResults.sort(
            (a, b) => b.result.similarity - a.result.similarity
          )
        })
      }
      return acc
    }, [])
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

      // Ensure the message is loaded in the view
      // This is async but we don't strictly need to await it for the UI to close,
      // but we do need it for the highlight to work.
      // We'll fire and forget the close, but await the load for the highlight?
      // Actually, if we close dialog immediately, the user sees the chat.
      // We should probably await the load fast.
      ensureMessageLoaded(result.sessionId, result.timestamp).then(() => {
        setHighlightedMessage({
          role: result.role,
          content: result.messageContent
        })
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
      setHighlightedMessage,
      ensureMessageLoaded
    ]
  )

  const formatTimestamp = useCallback(
    (timestamp: number) => {
      try {
        const date = new Date(timestamp)
        const now = Date.now()
        const diffMs = now - timestamp
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMs / 3600000)
        const diffDays = Math.floor(diffMs / 86400000)

        if (diffMins < 1) return t("chat.search.time_just_now")
        if (diffMins < 60)
          return `${diffMins} ${diffMins === 1 ? t("chat.search.time_minute") : t("chat.search.time_minutes")} ${t("chat.search.time_ago")}`
        if (diffHours < 24)
          return `${diffHours} ${diffHours === 1 ? t("chat.search.time_hour") : t("chat.search.time_hours")} ${t("chat.search.time_ago")}`
        if (diffDays < 7)
          return `${diffDays} ${diffDays === 1 ? t("chat.search.time_day") : t("chat.search.time_days")} ${t("chat.search.time_ago")}`

        return date.toLocaleDateString()
      } catch {
        return t("chat.search.time_unknown")
      }
    },
    [t]
  )

  const truncateText = useCallback((text: string, maxLength: number = 150) => {
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}...`
  }, [])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-full sm:max-w-lg h-[85vh] flex flex-col p-0 overflow-hidden gap-0 rounded-md">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-base">
              {t("chat.search.dialog_title")}
            </DialogTitle>
            <MiniBadge text={t("chat.search.beta_badge")} />
          </div>
          <DialogDescription className="hidden">
            {t("chat.search.dialog_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 space-y-3 shrink-0 bg-muted/10 border-b">
          {currentSessionId && (
            <Tabs
              value={searchScope}
              onValueChange={(value) =>
                setSearchScope(value as "all" | "current")
              }
              className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-8">
                <TabsTrigger value="all" className="text-xs">
                  {t("chat.search.scope_all")}
                </TabsTrigger>
                <TabsTrigger value="current" className="text-xs">
                  {t("chat.search.scope_current")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("chat.search.placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
              autoFocus
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-3">
            {isSearching ? (
              <div className="flex h-40 flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mb-2" />
                <p className="text-xs">{t("chat.search.searching")}</p>
              </div>
            ) : (debouncedQuery.trim() && results.length === 0) ||
              !debouncedQuery.trim() ? (
              <div className="flex h-80 flex-col items-center justify-center text-muted-foreground">
                {debouncedQuery.trim() && results.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t("chat.search.no_results")}
                  </div>
                )}

                {!debouncedQuery.trim() && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t("chat.search.start_typing")}
                  </div>
                )}
              </div>
            ) : (
              groupedResults.length > 0 && (
                <div className="space-y-5">
                  {groupedResults.map(
                    ({ sessionId, sessionTitle, results: sessionResults }) => (
                      <div key={sessionId} className="space-y-2">
                        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-1 flex items-center gap-2 border-b">
                          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium truncate flex-1">
                            {sessionTitle}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-5 px-1.5">
                            {sessionResults.length}
                          </Badge>
                        </div>

                        <div className="space-y-2 pl-2">
                          {sessionResults.map((result) => (
                            <button
                              key={`${result.sessionId}-${result.timestamp}-${result.result.document.id}`}
                              type="button"
                              className={cn(
                                "group relative w-full rounded-lg border border-border bg-card p-3 text-left",
                                "hover:bg-accent hover:border-accent-foreground/20",
                                "transition-all cursor-pointer shadow-sm"
                              )}
                              onClick={() => handleSelectResult(result)}>
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Badge
                                      variant={
                                        result.role === "user"
                                          ? "default"
                                          : "secondary"
                                      }
                                      className="text-[10px] h-5 px-1.5 capitalize shrink-0">
                                      {result.role === "user"
                                        ? t("chat.search.role_you")
                                        : t("chat.search.role_assistant")}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                                      <Clock className="h-3 w-3" />
                                      {formatTimestamp(result.timestamp)}
                                    </span>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] h-5 px-1.5 font-mono shrink-0">
                                    {Math.round(result.result.similarity * 100)}
                                    %
                                  </Badge>
                                </div>

                                <p className="text-sm text-foreground leading-relaxed break-words line-clamp-4">
                                  {truncateText(result.messageContent, 300)}
                                </p>
                              </div>
                              <ExternalLink className="h-4 w-4 absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
