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

interface ChatSessionSelectorProps {
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
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="m-1 rounded-xl border border-border/50 bg-background/50 shadow-xs backdrop-blur-xs transition-all duration-200 hover:bg-accent/50 cursor-pointer">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-80 border-r border-border/50 bg-background/95 p-0 backdrop-blur-xl">
        <div className="flex h-full flex-col">
          <SheetHeader className="flex-row items-center justify-between border-b border-border/50 p-4 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-primary/10 p-1.5 grayscale-50">
                <MessageSquare className="size-4 text-primary" />
              </div>
              <SheetTitle className="bg-linear-to-r from-foreground to-foreground/70 bg-clip-text text-lg font-semibold text-transparent">
                {t("sessions.selector.title")}
              </SheetTitle>
            </div>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-8 rounded-lg cursor-pointer bg-transparent">
                <X className="size-4.5 text-muted-foreground/80" />
              </Button>
            </SheetClose>
          </SheetHeader>

          <div className="p-2 space-y-2">
            <Button
              onClick={createSession}
              className="flex h-10 w-full items-center justify-start rounded-lg bg-linear-to-r from-primary to-primary/90 text-primary-foreground shadow-lg transition-all duration-200 hover:from-primary/90 hover:to-primary/80 hover:shadow-xl"
              aria-label={t("sessions.selector.create_new_aria")}>
              <SquarePen className="mr-2 h-4 w-4" />
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
