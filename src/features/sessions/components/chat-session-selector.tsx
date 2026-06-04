import { Menu, MessageSquare, SquarePen, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Virtuoso } from "react-virtuoso"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { ChatSessionEmpty } from "./chat-session-empty"
import { ChatSessionFooter } from "./chat-session-footer"
import { ChatSessionItem } from "./chat-session-item"

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
            className="m-1 cursor-pointer rounded-lg border border-sidebar-border bg-sidebar shadow-xs transition-all duration-200 hover:bg-sidebar-accent"
          />
        }>
        <Menu className="size-4" />
      </SheetTrigger>

      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-80 border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
        <div className="flex h-full flex-col">
          <SheetHeader className="flex-row items-center justify-between border-b border-sidebar-border p-4 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-sidebar-accent p-1.5">
                <MessageSquare className="size-4 text-sidebar-primary" />
              </div>
              <SheetTitle className="text-lg font-semibold text-sidebar-foreground">
                {t("sessions.selector.title")}
              </SheetTitle>
            </div>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-8 cursor-pointer rounded-lg bg-transparent hover:bg-sidebar-accent"
                />
              }>
              <X className="size-4.5 text-sidebar-foreground/70" />
            </SheetClose>
          </SheetHeader>

          <div className="p-2 space-y-2">
            <Button
              onClick={createSession}
              className="flex h-10 w-full items-center justify-start rounded-lg bg-sidebar-primary text-sidebar-primary-foreground transition-colors duration-200 hover:opacity-90"
              aria-label={t("sessions.selector.create_new_aria")}>
              <SquarePen className="mr-2 size-4" />
              {t("sessions.selector.start_new")}
            </Button>
            {searchTrigger}
          </div>

          <div className="flex-1 px-2 h-full">
            {sessions.length === 0 ? (
              <ChatSessionEmpty />
            ) : (
              <Virtuoso
                data={sessions}
                className="scrollbar-none"
                itemContent={(_index, session) => (
                  <ChatSessionItem
                    session={session}
                    isActive={session.id === currentSessionId}
                    onClick={setCurrentSessionId}
                    onDelete={deleteSession}
                  />
                )}
              />
            )}
          </div>

          <ChatSessionFooter sessionCount={sessions.length} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
