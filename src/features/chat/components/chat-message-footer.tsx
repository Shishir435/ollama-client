import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { CopyButton } from "@/features/chat/components/copy-button"
import { RegenerateButton } from "@/features/chat/components/regenerate-button"
import { SpeechButton } from "@/features/chat/components/speech-button"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  GitFork,
  MoreHorizontal,
  SquarePen,
  Trash2
} from "@/lib/lucide-icon"
import type { ChatMessage } from "@/types"

export const ChatMessageFooter = ({
  msg,
  isUser,
  isLoading,
  onRegenerate,
  onEdit,
  onDelete,
  onExport,
  onNavigate
}: {
  msg: ChatMessage
  isUser: boolean
  isLoading?: boolean
  onRegenerate?: (model: string) => void
  onEdit?: () => void
  onDelete?: () => void
  onExport?: () => void
  onNavigate?: (nodeId: number) => void
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={
        "mt-1 flex w-full max-w-[85vw] items-center justify-between text-xs text-gray-500 sm:max-w-2xl " +
        (isUser ? "flex-row-reverse" : "flex-row")
      }>
      <div className="flex flex-wrap items-center gap-1 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
        {/* Branch Navigation */}
        {msg.siblingIds && msg.siblingIds.length > 1 && msg.id && (
          <div className="mr-1 flex items-center gap-0.5 rounded-md bg-muted/50 px-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 cursor-pointer"
              disabled={msg.siblingIds.indexOf(msg.id) <= 0}
              onClick={() => {
                if (!msg.id || !msg.siblingIds) return
                const idx = msg.siblingIds.indexOf(msg.id)
                if (idx > 0) onNavigate?.(msg.siblingIds[idx - 1])
              }}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="mx-2 tabular-nums">
              {msg.siblingIds.indexOf(msg.id) + 1} / {msg.siblingIds.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 cursor-pointer"
              disabled={
                msg.siblingIds.indexOf(msg.id) >= msg.siblingIds.length - 1
              }
              onClick={() => {
                if (!msg.id || !msg.siblingIds) return
                const idx = msg.siblingIds.indexOf(msg.id)
                if (idx < msg.siblingIds.length - 1)
                  onNavigate?.(msg.siblingIds[idx + 1])
              }}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        <CopyButton text={msg.content} />

        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onEdit}
            title={t("chat.actions.edit", "Edit")}>
            <SquarePen className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Explicit Fork Button (Same as Edit for User messages, but labelled for clarity) */}
        {isUser && onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onEdit}
            title={t("chat.actions.fork", "Fork Conversation")}>
            <GitFork className="h-3.5 w-3.5" />
          </Button>
        )}

        <SpeechButton text={msg.content} />

        {!isUser && msg.model && !isLoading && (
          <RegenerateButton
            model={msg.model}
            onSelectModel={(model) => onRegenerate?.(model)}
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isUser ? "end" : "start"}>
            {onExport && (
              <DropdownMenuItem onClick={onExport}>
                <Download className="mr-2 h-4 w-4" />
                {t("chat.actions.export", "Export")}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                {t("chat.actions.delete", "Delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pt-1 text-[11px] opacity-50">
        {isUser
          ? new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            })
          : msg.model || ""}
      </div>
    </div>
  )
}
