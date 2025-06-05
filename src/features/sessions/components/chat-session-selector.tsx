import { Menu, MessageSquare, SquarePen, Trash2 } from "lucide-react"

import BugReportIcon from "@/components/bug-report-icon"
import SettingsButton from "@/components/settings-button"
import ThemeToggle from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useTheme } from "@/context/them-provider-context"
import { cn } from "@/lib/utils"
import { useChatSessions } from "@/features/sessions/context/chat-session-context"

export default function ChatSessionSelector() {
  const {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    createSession,
    deleteSession
  } = useChatSessions()

  const { theme } = useTheme()

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="m-1 rounded-xl border border-border/50 bg-background/50 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-accent/50">
          <Menu className="h-4 w-4" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        className="w-80 border-r border-border/50 bg-background/95 p-0 backdrop-blur-xl">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="border-b border-border/50 p-4 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg bg-primary/10 p-1.5">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <h2 className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-lg font-semibold text-transparent">
                Chat Sessions
              </h2>
            </div>
          </div>

          <div className="p-3 pb-2">
            <Button
              onClick={createSession}
              className="flex h-10 w-full items-center justify-start rounded-lg bg-gradient-to-r from-primary to-primary/90 text-primary-foreground shadow-lg transition-all duration-200 hover:from-primary/90 hover:to-primary/80 hover:shadow-xl"
              aria-label="Create New Chat">
              <SquarePen className="mr-2 h-4 w-4" />
              Start New Chat
            </Button>
          </div>

          <ScrollArea className="flex-1 px-3">
            <div className="space-y-1 pb-3">
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="mb-3 rounded-full bg-muted/50 p-3">
                    <MessageSquare className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No chat sessions yet
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    Create your first chat to get started
                  </p>
                </div>
              ) : (
                sessions.map((session) => {
                  const trimmedTitle =
                    session.title.length > 25
                      ? session.title.slice(0, 25) + "..."
                      : session.title

                  const isActive = session.id === currentSessionId

                  return (
                    <div
                      key={session.id}
                      className={cn(
                        "group relative overflow-hidden rounded-lg transition-all duration-200",
                        isActive
                          ? "border border-primary/20 bg-gradient-to-r from-primary/15 to-primary/10 shadow-sm"
                          : "border border-transparent hover:bg-accent/50"
                      )}>
                      {/* Active indicator */}
                      {isActive && (
                        <div className="absolute bottom-0 left-0 top-0 w-1 rounded-r-lg bg-gradient-to-b from-primary to-primary/70" />
                      )}

                      <div className="flex items-center p-2 pl-3">
                        {/* Session Button */}
                        <Button
                          variant="ghost"
                          className={cn(
                            "h-auto flex-1 justify-start p-0 text-left hover:bg-transparent",
                            isActive
                              ? "font-medium text-primary"
                              : "text-foreground/80 hover:text-foreground"
                          )}
                          title={session.title}
                          onClick={() => setCurrentSessionId(session.id)}>
                          <div className="flex w-full min-w-0 items-center gap-3">
                            <div
                              className={cn(
                                "shrink-0 rounded-lg p-1",
                                isActive
                                  ? "bg-primary/20"
                                  : "bg-muted/50 group-hover:bg-muted"
                              )}>
                              <MessageSquare
                                className={cn(
                                  "h-3 w-3",
                                  isActive
                                    ? "text-primary"
                                    : "text-muted-foreground"
                                )}
                              />
                            </div>
                            <span className="truncate text-sm leading-relaxed">
                              {trimmedTitle}
                            </span>
                          </div>
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-8 w-8 shrink-0 rounded-lg transition-all duration-200",
                            "opacity-0 group-hover:opacity-100",
                            "hover:bg-destructive/10 hover:text-destructive",
                            "focus:bg-destructive/10 focus:text-destructive focus:opacity-100"
                          )}
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteSession(session.id)
                          }}
                          aria-label={`Delete chat session: ${session.title}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </ScrollArea>
          <div className="border-t border-border/50 p-2">
            <div className="flex items-center justify-center gap-2">
              <div className="flex flex-1 items-center rounded-lg bg-muted/20 p-1 transition-all duration-200 hover:bg-muted/40">
                <SettingsButton />
              </div>

              <div className="flex flex-1 items-center rounded-lg bg-muted/20 p-1 transition-all duration-200 hover:bg-muted/40">
                <BugReportIcon />
              </div>

              <div className="flex flex-1 items-center rounded-lg bg-muted/20 p-1 transition-all duration-200 hover:bg-muted/40">
                <ThemeToggle />
              </div>
            </div>
          </div>

          <div className="border-t border-border/50 bg-muted/20 p-3 pt-2">
            <div className="text-center text-xs text-muted-foreground">
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
