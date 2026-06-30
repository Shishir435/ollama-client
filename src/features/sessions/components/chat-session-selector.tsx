import { PanelLeftOpen } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { Search, X } from "@/lib/lucide-icon"
import { useSearchDialogStore } from "@/stores/search-dialog-store"
import { ChatSessionFooter } from "./chat-session-footer"
import { ChatSessionList } from "./chat-session-list"
import { ChatSessionSidebarHeader } from "./chat-session-sidebar-header"

export const ChatSessionSelector = () => {
  const { t } = useTranslation()
  const openSearchDialog = useSearchDialogStore((s) => s.openSearchDialog)
  const [isOpen, setIsOpen] = useState(false)
  const [sessionQuery, setSessionQuery] = useState("")
  const {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    createSession,
    deleteSession
  } = useChatSessions()

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) setSessionQuery("")
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

      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-80 border-r border-sidebar-border bg-surface-sidebar p-0 text-sidebar-foreground">
        <div className="flex h-full flex-col">
          <ChatSessionSidebarHeader
            onCreateSession={createSession}
            sessionCount={sessions.length}
          />

          <div className="space-y-2 p-2">
            <Button
              onClick={createSession}
              className="flex h-9 w-full items-center justify-start rounded-control bg-sidebar-primary text-sidebar-primary-foreground transition-colors duration-200 hover:opacity-90"
              aria-label={t("sessions.selector.create_new_aria")}>
              {t("sessions.selector.start_new")}
            </Button>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 icon-sm -translate-y-1/2 text-sidebar-foreground/50" />
              <Input
                type="search"
                value={sessionQuery}
                onChange={(event) => setSessionQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  const query = sessionQuery.trim()
                  if (!query) return
                  // Escalate the title filter to full semantic search over
                  // message content, then close the sidebar so the dialog is clear.
                  openSearchDialog(query)
                  handleOpenChange(false)
                }}
                placeholder={t("sessions.selector.search_placeholder")}
                aria-label={t("sessions.selector.search_placeholder")}
                className="h-9 bg-background/70 pl-8 pr-8 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {sessionQuery && (
                <TooltipActionButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  label={t("sessions.selector.clear_search")}
                  onClick={() => setSessionQuery("")}
                  className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-sidebar-foreground/60"
                  icon={X}
                  iconClassName="icon-xs"
                />
              )}
            </div>
          </div>

          <div className="h-full flex-1 px-2">
            <ChatSessionList
              sessions={sessions}
              query={sessionQuery}
              currentSessionId={currentSessionId}
              onSelect={setCurrentSessionId}
              onDelete={deleteSession}
            />
          </div>

          <ChatSessionFooter />
        </div>
      </SheetContent>
    </Sheet>
  )
}
