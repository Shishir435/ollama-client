import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { CopyButton } from "@/features/chat/components/copy-button"
import { RAGSourcesButton } from "@/features/chat/components/rag-sources-button"
import { RegenerateButton } from "@/features/chat/components/regenerate-button"
import { SpeechButton } from "@/features/chat/components/speech-button"
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code,
  FileDown,
  FileText,
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
  showRetrievedChunks = true,
  feedbackEnabled = true,
  onRegenerate,
  onEdit,
  onDelete,
  onExport,
  onNavigate
}: {
  msg: ChatMessage
  isUser: boolean
  isLoading?: boolean
  showRetrievedChunks?: boolean
  feedbackEnabled?: boolean
  onRegenerate?: (model: string) => void
  onEdit?: () => void
  onDelete?: () => void
  onExport?: (format: "json" | "pdf" | "markdown" | "text") => void
  onNavigate?: (nodeId: number | string) => void
}) => {
  const { t } = useTranslation()
  const siblingIds = msg.siblingIds ?? []
  const siblingIndex =
    msg.id != null
      ? siblingIds.findIndex((id) => String(id) === String(msg.id))
      : -1
  const canShowBranchNavigation =
    siblingIds.length > 1 && msg.id != null && siblingIndex !== -1

  const navigateToSibling = (targetIndex: number) => {
    const targetNodeId = siblingIds[targetIndex]
    if (targetNodeId === undefined) return
    onNavigate?.(targetNodeId)
  }

  const actionItems = [
    onExport
      ? {
          key: "markdown",
          label: "Markdown",
          onClick: () => onExport("markdown"),
          icon: <BookOpen className="size-4" />,
          destructive: false
        }
      : null,
    onExport
      ? {
          key: "pdf",
          label: "PDF",
          onClick: () => onExport("pdf"),
          icon: <FileDown className="size-4" />,
          destructive: false
        }
      : null,
    onExport
      ? {
          key: "json",
          label: "JSON",
          onClick: () => onExport("json"),
          icon: <Code className="size-4" />,
          destructive: false
        }
      : null,
    onExport
      ? {
          key: "text",
          label: "Text",
          onClick: () => onExport("text"),
          icon: <FileText className="size-4" />,
          destructive: false
        }
      : null,
    onDelete
      ? {
          key: "delete",
          label: t("chat.actions.delete"),
          onClick: () => onDelete(),
          icon: <Trash2 className="size-4" />,
          destructive: true
        }
      : null
  ].filter(Boolean) as Array<{
    key: string
    label: string
    onClick: () => void
    icon: React.ReactNode
    destructive: boolean
  }>

  return (
    <div
      className={
        "mt-2 flex w-full items-center gap-2 " +
        (isUser ? "flex-row-reverse" : "flex-row")
      }>
      {/* Branch Navigation */}
      {canShowBranchNavigation && (
        <div className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            disabled={siblingIndex <= 0}
            onClick={() => {
              if (siblingIndex > 0) navigateToSibling(siblingIndex - 1)
            }}>
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="min-w-6 text-center text-[10px] font-medium text-muted-foreground">
            {siblingIndex + 1} / {siblingIds.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            disabled={siblingIndex >= siblingIds.length - 1}
            onClick={() => {
              if (siblingIndex < siblingIds.length - 1)
                navigateToSibling(siblingIndex + 1)
            }}>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Main Actions Group */}
      <div className="flex items-center gap-1 rounded-full px-1.5 py-0.5 opacity-100 transition-opacity group-hover:opacity-100 sm:opacity-0">
        <CopyButton text={msg.content} />

        <SpeechButton text={msg.content} />

        {/* RAG Sources Button - Show for messages with RAG context */}
        {showRetrievedChunks &&
          msg.metrics?.ragSources &&
          msg.metrics.ragSources.length > 0 && (
            <RAGSourcesButton
              sources={msg.metrics.ragSources}
              query={msg.metrics.ragQuery}
              enableFeedback={feedbackEnabled}
            />
          )}

        {onEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={onEdit}
                title={
                  isUser ? t("chat.actions.fork") : t("chat.actions.edit")
                }>
                {isUser ? (
                  <GitFork className="size-3.5" />
                ) : (
                  <SquarePen className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isUser ? t("chat.actions.fork") : t("chat.actions.edit")}
            </TooltipContent>
          </Tooltip>
        )}

        {!isUser && msg.model && !isLoading && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <RegenerateButton
                  model={msg.model}
                  onSelectModel={(model) => onRegenerate?.(model)}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("chat.actions.switch_model_tooltip")}
            </TooltipContent>
          </Tooltip>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60"
              title={t("chat.actions.more")}
              aria-label={t("chat.actions.more")}>
              <MoreHorizontal className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={isUser ? "end" : "start"}
            sideOffset={6}
            className="w-auto rounded-lg border-muted/60 p-1.5 shadow-lg data-open:animate-none data-closed:animate-none">
            {actionItems.length > 0 && (
              <DropdownMenuGroup>
                <div className="grid grid-cols-5 justify-items-center gap-0.5 px-1 py-1">
                  {actionItems.map((item) => (
                    <Tooltip key={item.key}>
                      <TooltipTrigger asChild>
                        <DropdownMenuItem
                          onClick={item.onClick}
                          aria-label={item.label}
                          className={
                            item.destructive
                              ? "size-8 justify-center rounded-md text-destructive hover:bg-destructive/10"
                              : "size-8 justify-center rounded-md hover:bg-muted/60"
                          }>
                          {item.icon}
                        </DropdownMenuItem>
                      </TooltipTrigger>
                      <TooltipContent>{item.label}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </DropdownMenuGroup>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
        {isUser
          ? new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit"
            })
          : `${msg.model?.slice(0, 25)}`}
      </div>
    </div>
  )
}
