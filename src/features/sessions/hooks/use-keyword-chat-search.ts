import { useEffect, useState } from "react"
import { useDebounce } from "@/hooks/use-debounce"
import { logger } from "@/lib/logger"
import {
  type MessageSearchHit,
  searchMessages
} from "@/lib/repositories/chat-history"
import { MIN_SEARCH_CHARS } from "@/lib/repositories/message-search"

const DEBOUNCE_MS = 250
const RESULT_LIMIT = 30

/**
 * Keyword search over message text for the sidebar field. Debounced so typing
 * does not query on every key, bounded by a result limit, and ordered by
 * relevance. A slower earlier answer is discarded rather than shown after a
 * newer one; a failure leaves the title matches as they were.
 */
export const useKeywordChatSearch = (query: string) => {
  const debounced = useDebounce(query.trim(), DEBOUNCE_MS)
  const active = debounced.length >= MIN_SEARCH_CHARS
  const [answer, setAnswer] = useState<{
    query: string
    hits: MessageSearchHit[]
  } | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    searchMessages(debounced, RESULT_LIMIT)
      .then((hits) => {
        if (!cancelled) setAnswer({ query: debounced, hits })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        logger.warn("Keyword chat search failed", "KeywordChatSearch", {
          name: error instanceof Error ? error.name : typeof error
        })
        setAnswer({ query: debounced, hits: [] })
      })
    return () => {
      cancelled = true
    }
  }, [active, debounced])

  const current = active && answer?.query === debounced ? answer.hits : null
  return {
    /** Hits for the settled query; empty while a newer one is pending. */
    hits: current ?? [],
    /** Typed but not yet answered: the debounce or the query is in flight. */
    searching:
      query.trim().length >= MIN_SEARCH_CHARS &&
      (query.trim() !== debounced || current === null)
  }
}
