import { CopyButton } from "@/features/chat/components/copy-button"
import RegenerateButton from "@/features/chat/components/regenerate-button"
import SpeechButton from "@/features/chat/components/speech-button"
import type { ChatMessage } from "@/types"

export default function ChatMessageFooter({
  msg,
  isUser,
  isLoading,
  onRegenerate
}: {
  msg: ChatMessage
  isUser: boolean
  isLoading?: boolean
  onRegenerate?: (model: string) => void
}) {
  return (
    <div
      className={
        "mt-1 flex w-full max-w-[85vw] items-center justify-between text-xs text-gray-500 sm:max-w-2xl " +
        (isUser ? "flex-row-reverse" : "flex-row")
      }>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <CopyButton text={msg.content} />
        <SpeechButton text={msg.content} />
        {!isUser && msg.model && !isLoading && (
          <RegenerateButton
            model={msg.model}
            onSelectModel={(model) => onRegenerate?.(model)}
          />
        )}
      </div>

      <div className="pt-1 text-[11px]">
        {isUser
          ? new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            })
          : msg.model || ""}
      </div>
    </div>
  )
}
