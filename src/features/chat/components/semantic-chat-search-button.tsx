import { useState } from "react"
import { Button } from "@/components/ui/button"
import { SemanticChatSearchDialog } from "@/features/chat/components/semantic-chat-search-dialog"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { Search } from "@/lib/lucide-icon"

export const SemanticChatSearchButton = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const { currentSessionId } = useChatSessions()

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setIsSearchOpen(true)}
        className="flex h-10 w-full items-center justify-start rounded-lg border-border/50 bg-background/50 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-accent/50"
        title="Search chat history (semantic search)">
        <Search className="mr-2 h-4 w-4" />
        Search Chats
      </Button>

      <SemanticChatSearchDialog
        open={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        currentSessionId={currentSessionId}
      />
    </>
  )
}
