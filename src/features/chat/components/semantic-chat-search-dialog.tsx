import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { MiniBadge } from "@/components/ui/mini-badge"
import {
  type ChatSearchResult,
  useSemanticChatSearch
} from "@/features/chat/hooks/use-semantic-chat-search"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useDebounce } from "@/hooks/use-debounce"
import { Loader2 } from "@/lib/lucide-icon"

import { SearchEmptyState } from "./search/search-empty-state"
import { SearchInput } from "./search/search-input"
import { SearchResultGroup } from "./search/search-result-group"
import { SearchScopeTabs } from "./search/search-scope-tabs"

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
      ensureMessageLoaded(
        result.sessionId,
        result.timestamp,
        result.messageId
      ).then(() => {
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-full sm:max-w-lg h-[85vh] flex flex-col p-0 overflow-hidden gap-0 rounded-xl border-border/60 shadow-2xl">
        <DialogHeader className="px-5 py-4 border-b shrink-0 bg-background/50 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-base font-bold tracking-tight">
              {t("chat.search.dialog_title")}
            </DialogTitle>
            <MiniBadge
              text={t("chat.search.beta_badge")}
              className="bg-primary/10 text-primary border-primary/20"
            />
          </div>
          <DialogDescription className="hidden">
            {t("chat.search.dialog_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-4 shrink-0 bg-muted/5 border-b">
          {currentSessionId && (
            <SearchScopeTabs
              value={searchScope}
              onValueChange={setSearchScope}
            />
          )}

          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            isSearching={isSearching}
          />

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded-md border border-destructive/20 animate-in fade-in slide-in-from-top-1">
              {error}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 bg-background/30">
          <div className="p-4">
            {isSearching && results.length === 0 ? (
              <div className="flex h-60 flex-col items-center justify-center text-muted-foreground animate-in fade-in duration-500">
                <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary/40" />
                <p className="text-xs font-medium">
                  {t("chat.search.searching")}
                </p>
              </div>
            ) : groupedResults.length > 0 ? (
              <div className="space-y-8 pb-4">
                {groupedResults.map((group) => (
                  <SearchResultGroup
                    key={group.sessionId}
                    sessionId={group.sessionId}
                    sessionTitle={group.sessionTitle}
                    results={group.results}
                    onSelectResult={handleSelectResult}
                  />
                ))}
              </div>
            ) : (
              <SearchEmptyState
                hasQuery={!!debouncedQuery.trim()}
                hasResults={results.length > 0}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
