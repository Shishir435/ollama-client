import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { MiniBadge } from "@/components/ui/mini-badge"
import { SemanticChatSearchDialog } from "@/features/chat/components/semantic-chat-search-dialog"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { Search } from "@/lib/lucide-icon"

export const SemanticChatSearchButton = () => {
  const { t } = useTranslation()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const { currentSessionId } = useChatSessions()

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setIsSearchOpen(true)}
        className="flex h-10 w-full items-center justify-start rounded-lg border-border/50 bg-background/50 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-accent/50"
        title={t("chat.search.button_title")}>
        <Search className="mr-2 h-4 w-4" />
        {t("chat.search.button_label")}
        <MiniBadge text={t("chat.search.beta_badge")} />
      </Button>

      <SemanticChatSearchDialog
        open={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        currentSessionId={currentSessionId}
      />
    </>
  )
}
