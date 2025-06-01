import { Menu, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useChatSessions } from "@/context/chat-session-context"
import { cn } from "@/lib/utils"

export default function ChatSessionSelector() {
  const {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    createSession,
    deleteSession
  } = useChatSessions()

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="m-1 rounded-2xl">
          <Menu className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-4">
        <div className="flex h-full flex-col">
          <h2 className="mb-4 text-lg font-semibold">Chats</h2>

          <Button
            className="mb-4 w-full"
            variant="default"
            onClick={createSession}>
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Button>

          <ScrollArea className="flex-1 pr-2">
            <ul className="space-y-1">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="group flex items-center justify-between rounded px-2 py-1 transition-colors hover:bg-muted">
                  <button
                    className={cn(
                      "w-full truncate text-left text-sm",
                      session.id === currentSessionId
                        ? "font-semibold text-primary"
                        : "text-muted-foreground"
                    )}
                    onClick={() => setCurrentSessionId(session.id)}>
                    {session.title}
                  </button>
                  <button
                    onClick={() => deleteSession(session.id)}
                    className="ml-2 text-red-500 opacity-0 transition-opacity group-hover:opacity-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}
