import { PanelLeftOpen, Search, X } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useDeferredSessionDelete } from "@/features/sessions/hooks/use-deferred-session-delete"
import { useKeywordChatSearch } from "@/features/sessions/hooks/use-keyword-chat-search"
import {
  chatSessionStore,
  useChatSessions
} from "@/features/sessions/stores/chat-session-store"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import type { MessageSearchHit } from "@/lib/repositories/chat-history"
import { useSearchDialogStore } from "@/stores/search-dialog-store"
import {
  ChatMessageSearchResults,
  type MessageSearchRow
} from "./chat-message-search-results"
import { ChatSessionFooter } from "./chat-session-footer"
import { ChatSessionList } from "./chat-session-list"
import { ChatSessionSidebarHeader } from "./chat-session-sidebar-header"
import { CurrentChatTitle } from "./current-chat-title"

export const ChatSessionSelector = () => {
  const { t } = useTranslation()
  const openSearchDialog = useSearchDialogStore((s) => s.openSearchDialog)
  const [isOpen, setIsOpen] = useState(false)
  const [sessionQuery, setSessionQuery] = useState("")
  const [pendingDelete, setPendingDelete] = useState<{
    id: string
    title: string
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const {
    sessions: allSessions,
    currentSessionId,
    setCurrentSessionId,
    createSession,
    deleteSession,
    ensureMessageLoaded,
    setHighlightedMessage
  } = useChatSessions(false)

  const { hiddenIds, schedule: scheduleDelete } =
    useDeferredSessionDelete(deleteSession)
  /** Chats waiting out their Undo window are already gone from every list. */
  const sessions = useMemo(
    () => allSessions.filter((session) => !hiddenIds.has(session.id)),
    [allSessions, hiddenIds]
  )

  const keyword = useKeywordChatSearch(sessionQuery)
  const messageRows = useMemo<MessageSearchRow[]>(() => {
    const titles = new Map(
      sessions.map((session) => [session.id, session.title])
    )
    return keyword.hits.flatMap((hit) => {
      const sessionTitle = titles.get(hit.sessionId)
      return sessionTitle === undefined ? [] : [{ hit, sessionTitle }]
    })
  }, [keyword.hits, sessions])

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) setSessionQuery("")
  }

  /**
   * Open the chat a keyword hit is in, scrolled to that message. The chat
   * loads its newest page, so older pages are read until the hit is in view.
   */
  const openMessageHit = async (hit: MessageSearchHit) => {
    if (hit.sessionId !== currentSessionId) setCurrentSessionId(hit.sessionId)
    handleOpenChange(false)
    await ensureMessageLoaded(hit.sessionId, hit.timestamp, hit.messageId)
    /**
     * Paging loads the open chat, so it stops once the user moves on, and once
     * a page adds nothing.
     */
    const stillOpen = () =>
      chatSessionStore.getState().currentSessionId === hit.sessionId
    const loadedPath = () =>
      chatSessionStore
        .getState()
        .sessions.find((session) => session.id === hit.sessionId)?.messages ??
      []
    while (stillOpen() && chatSessionStore.getState().hasMoreMessages) {
      const before = loadedPath()
      if (before.some((message) => message.id === hit.messageId)) break
      await chatSessionStore.getState().loadMoreMessages()
      if (loadedPath().length === before.length) break
    }
    if (!stillOpen()) return
    setHighlightedMessage({
      id: hit.messageId,
      role: hit.role,
      content: hit.snippet.map((part) => part.text).join("")
    })
  }

  const currentTitle = sessions.find(
    (session) => session.id === currentSessionId
  )?.title

  /** Escalate the title filter to semantic search over message content. */
  const searchMessages = () => {
    const query = sessionQuery.trim()
    if (!query) return
    openSearchDialog(query)
    handleOpenChange(false)
  }

  useKeyboardShortcuts({
    closeSidebar: (e) => {
      e.preventDefault()
      handleOpenChange(!isOpen)
    }
  })

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <TooltipActionButton
        label={t("sessions.selector.title")}
        trigger={
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("sessions.selector.title")}
              />
            }>
            <PanelLeftOpen className="icon-sm" />
          </SheetTrigger>
        }
      />

      {currentTitle && currentSessionId && (
        <CurrentChatTitle sessionId={currentSessionId} title={currentTitle} />
      )}

      <SheetContent
        side="left"
        showCloseButton={false}
        /**
         * Land on the search field (or the create button when there is
         * nothing to search), not the header's first icon: focusing that
         * opens its tooltip, and the first Escape then only closes the tooltip.
         */
        initialFocus={() => searchInputRef.current ?? createButtonRef.current}
        className="w-80 border-r border-sidebar-border bg-surface-sidebar p-0 text-sidebar-foreground">
        <div className="flex h-full flex-col">
          <ChatSessionSidebarHeader />

          <div className="space-y-2 p-2">
            <Button
              ref={createButtonRef}
              onClick={createSession}
              className="flex h-9 w-full items-center justify-start rounded-control bg-sidebar-primary text-sidebar-primary-foreground transition-colors duration-200 hover:opacity-90">
              {t("sessions.selector.create_new")}
            </Button>
            {sessions.length > 0 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 icon-sm -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="search"
                  value={sessionQuery}
                  onChange={(event) => setSessionQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return
                    event.preventDefault()
                    searchMessages()
                  }}
                  placeholder={t("sessions.selector.search_placeholder")}
                  aria-label={t("sessions.selector.search_placeholder")}
                  className="h-9 bg-surface-sunken pl-8 pr-8 [&::-webkit-search-cancel-button]:appearance-none"
                />
                {sessionQuery && (
                  <TooltipActionButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    label={t("sessions.selector.clear_search")}
                    onClick={() => setSessionQuery("")}
                    className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
                    icon={X}
                    iconClassName="icon-xs"
                  />
                )}
              </div>
            )}
            {sessionQuery.trim() && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={searchMessages}
                className="h-8 w-full justify-start gap-2 rounded-control px-2 text-xs text-muted-foreground">
                <Search className="icon-xs shrink-0" />
                <span className="min-w-0 truncate">
                  {t("sessions.selector.search_messages", {
                    query: sessionQuery.trim()
                  })}
                </span>
              </Button>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1 px-2">
            <div
              className={
                messageRows.length > 0 || keyword.searching
                  ? "min-h-0 flex-[2_1_0%]"
                  : "min-h-0 flex-1"
              }>
              <ChatSessionList
                sessions={sessions}
                query={sessionQuery}
                currentSessionId={currentSessionId}
                onSelect={setCurrentSessionId}
                onDelete={(id) =>
                  setPendingDelete({
                    id,
                    title: sessions.find((s) => s.id === id)?.title ?? ""
                  })
                }
                onCreate={createSession}
                suppressEmptySearch={
                  messageRows.length > 0 || keyword.searching
                }
              />
            </div>
            {(messageRows.length > 0 || keyword.searching) && (
              <div className="min-h-0 flex-[3_1_0%] overflow-y-auto">
                <ChatMessageSearchResults
                  rows={messageRows}
                  searching={keyword.searching}
                  onOpen={(hit) => void openMessageHit(hit)}
                />
              </div>
            )}
          </div>

          <ChatSessionFooter />
        </div>
      </SheetContent>
      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title={t("sessions.delete.confirm_title")}
        description={t("sessions.delete.confirm_description", {
          title: pendingDelete?.title ?? ""
        })}
        confirmLabel={t("sessions.delete.tooltip")}
        destructive
        onConfirm={() => {
          if (pendingDelete) {
            const { id } = pendingDelete
            /**
             * Leave the chat being hidden first: the panel must not keep
             * showing a conversation that is already out of the list.
             */
            if (id === currentSessionId) {
              const next = sessions.find((session) => session.id !== id)
              if (next) setCurrentSessionId(next.id)
              else createSession()
            }
            scheduleDelete(id)
          }
          setPendingDelete(null)
        }}
      />
    </Sheet>
  )
}
