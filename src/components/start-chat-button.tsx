import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { Zap } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const StartChatButton = ({ className }: { className?: string }) => {
  const { status } = useProviderModels()
  const { createSession } = useChatSessions()
  const { t } = useTranslation()

  const isBlocked = status === "error" || status === "empty"

  const handleStartChat = async () => {
    await createSession()
    document.getElementById("chat-input-textarea")?.focus()
  }

  return (
    <Button
      className={cn(
        "group flex items-center justify-center gap-2 rounded-xl py-6 text-base font-semibold shadow-sm transition-all duration-300",
        isBlocked
          ? "cursor-not-allowed bg-muted text-muted-foreground"
          : "bg-foreground text-background hover:bg-foreground/90 hover:shadow-md hover:-translate-y-0.5",
        className
      )}
      disabled={isBlocked}
      onClick={handleStartChat}>
      <Zap
        className={cn(
          "h-5 w-5 transition-transform",
          !isBlocked && "group-hover:rotate-12 group-hover:scale-110"
        )}
      />
      {t("welcome.start_chatting")}
    </Button>
  )
}
