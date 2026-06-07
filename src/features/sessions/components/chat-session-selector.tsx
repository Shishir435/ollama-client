import { Menu } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { ChatSessionFooter } from "./chat-session-footer"
import { ChatSessionList } from "./chat-session-list"
import { ChatSessionSidebarHeader } from "./chat-session-sidebar-header"

export interface ChatSessionSelectorProps {
  searchTrigger?: React.ReactNode
}

export const ChatSessionSelector = ({
  searchTrigger
}: ChatSessionSelectorProps) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    createSession,
    deleteSession
  } = useChatSessions()

  useKeyboardShortcuts({
    closeSidebar: (e) => {
      e.preventDefault()
      setIsOpen((prev) => !prev)
    }
  })

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="m-1 cursor-pointer rounded-control border border-sidebar-border bg-surface-sidebar shadow-xs transition-all duration-200 hover:bg-sidebar-accent"
          />
        }>
        <Menu className="icon-md" />
      </SheetTrigger>

      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-80 border-r border-sidebar-border bg-surface-sidebar p-0 text-sidebar-foreground">
        <div className="flex h-full flex-col">
          <ChatSessionSidebarHeader onCreateSession={createSession} />

          <div className="space-y-2 p-2">
            <Button
              onClick={createSession}
              className="flex h-9 w-full items-center justify-start rounded-control bg-sidebar-primary text-sidebar-primary-foreground transition-colors duration-200 hover:opacity-90"
              aria-label={t("sessions.selector.create_new_aria")}>
              {t("sessions.selector.start_new")}
            </Button>
            {searchTrigger}
          </div>

          <div className="h-full flex-1 px-2">
            <ChatSessionList
              sessions={sessions}
              currentSessionId={currentSessionId}
              onSelect={setCurrentSessionId}
              onDelete={deleteSession}
            />
          </div>

          <ChatSessionFooter sessionCount={sessions.length} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
