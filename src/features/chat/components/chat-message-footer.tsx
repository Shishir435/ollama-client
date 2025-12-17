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
  onExport?: (format: "json" | "pdf" | "markdown" | "text") => void
  onNavigate?: (nodeId: number) => void
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={
        "mt-2 flex w-full items-center gap-2 " +
        (isUser ? "flex-row-reverse" : "flex-row")
      }>
      {/* Branch Navigation */}
      {msg.siblingIds && msg.siblingIds.length > 1 && msg.id && (
        <div className="flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            disabled={msg.siblingIds.indexOf(msg.id) <= 0}
            onClick={() => {
              if (!msg.id || !msg.siblingIds) return
              const idx = msg.siblingIds.indexOf(msg.id)
              if (idx > 0) onNavigate?.(msg.siblingIds[idx - 1])
            }}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="min-w-[1.5rem] text-center text-[10px] font-medium text-muted-foreground">
            {msg.siblingIds.indexOf(msg.id) + 1} / {msg.siblingIds.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            disabled={
              msg.siblingIds.indexOf(msg.id) >= msg.siblingIds.length - 1
            }
            onClick={() => {
              if (!msg.id || !msg.siblingIds) return
              const idx = msg.siblingIds.indexOf(msg.id)
              if (idx < msg.siblingIds.length - 1)
                onNavigate?.(msg.siblingIds[idx + 1])
            }}>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Main Actions Group */}
      <div className="flex items-center gap-1 opacity-100 transition-opacity group-hover:opacity-100 sm:opacity-0">
        <CopyButton text={msg.content} />

        <SpeechButton text={msg.content} />

        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
            title={
              isUser
                ? t("chat.actions.fork", "Fork")
                : t("chat.actions.edit", "Edit")
            }>
            {isUser ? (
              <GitFork className="h-3.5 w-3.5" />
            ) : (
              <SquarePen className="h-3.5 w-3.5" />
            )}
          </Button>
        )}

        {!isUser && msg.model && !isLoading && (
          <RegenerateButton
            model={msg.model}
            onSelectModel={(model) => onRegenerate?.(model)}
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={isUser ? "end" : "start"}
            className="w-48">
            {onExport && (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  {t("chat.actions.export_as", "Export as...")}
                </div>
                <DropdownMenuItem onClick={() => onExport("markdown")}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onExport("pdf")}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onExport("json")}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onExport("text")}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Text
                </DropdownMenuItem>
                <div className="my-1 h-px bg-muted" />
              </>
            )}

            {onDelete && (
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                {t("chat.actions.delete", "Delete Message")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ml-auto text-[10px] text-muted-foreground/60">
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
