import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Button } from "@/components/ui/button"
import { MiniBadge } from "@/components/ui/mini-badge"
import { SemanticChatSearchDialog } from "@/features/chat/components/semantic-chat-search-dialog"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { Search } from "@/lib/lucide-icon"
import { useSearchDialogStore } from "@/stores/search-dialog-store"

export const SemanticChatSearchButton = () => {
  const { t } = useTranslation()
  const { isOpen, openSearchDialog, closeSearchDialog } = useSearchDialogStore()
  const { currentSessionId } = useChatSessions()

  return (
    <>
      <TooltipActionButton
        trigger={
          <Button
            type="button"
            variant="outline"
            onClick={openSearchDialog}
            className="flex h-9 w-full items-center justify-start rounded-control border-border/50 bg-background/70 shadow-xs transition-all duration-200 hover:bg-sidebar-accent"
          />
        }
        icon={<Search className="mr-2 icon-md" />}
        label={
          <>
            {t("chat.search.button_label")}
            <MiniBadge text={t("chat.search.beta_badge")} />
          </>
        }
        tooltip={t("chat.search.button_title")}
        showLabel
        labelClassName="inline-flex items-center gap-1"
      />

      <SemanticChatSearchDialog
        open={isOpen}
        onClose={closeSearchDialog}
        currentSessionId={currentSessionId}
      />
    </>
  )
}
