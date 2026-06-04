import { useTranslation } from "react-i18next"

import {
  ActionMenuGrid,
  type ActionMenuItemConfig,
  TooltipActionButton
} from "@/components/actions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import { UsedContextButton } from "@/features/chat/components/used-context-button"
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code,
  FileDown,
  FileText,
  GitFork,
  MoreHorizontal,
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

  const actionItems: ActionMenuItemConfig[] = [
    onExport
      ? {
          key: "markdown",
          label: "Markdown",
          onClick: () => onExport("markdown"),
          icon: <BookOpen className="size-4" />
        }
      : null,
    onExport
      ? {
          key: "pdf",
          label: "PDF",
          onClick: () => onExport("pdf"),
          icon: <FileDown className="size-4" />
        }
      : null,
    onExport
      ? {
          key: "json",
          label: "JSON",
          onClick: () => onExport("json"),
          icon: <Code className="size-4" />
        }
      : null,
    onExport
      ? {
          key: "text",
          label: "Text",
          onClick: () => onExport("text"),
          icon: <FileText className="size-4" />
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
  ].filter(Boolean) as ActionMenuItemConfig[]

  return (
    <div
      className={
        "flex w-full items-center gap-3 " +
        (isUser ? "flex-row-reverse" : "flex-row")
      }>
      {/* Branch Navigation */}
      {canShowBranchNavigation && (
        <div className="flex items-center gap-0.5 rounded-full px-1 py-0.5">
          <Button
            variant="ghost"
            aria-label="previous"
            size="icon"
            className="size-5 rounded-full"
            disabled={siblingIndex <= 0}
            onClick={() => {
              if (siblingIndex > 0) navigateToSibling(siblingIndex - 1)
            }}>
            <ChevronLeft className="size-3" />
          </Button>
          <span className="min-w-6 text-center text-[10px] font-medium text-muted-foreground">
            {siblingIndex + 1} / {siblingIds.length}
          </span>
          <Button
            variant="ghost"
            aria-label="next"
            size="icon"
            className="size-5 rounded-full"
            disabled={siblingIndex >= siblingIds.length - 1}
            onClick={() => {
              if (siblingIndex < siblingIds.length - 1)
                navigateToSibling(siblingIndex + 1)
            }}>
            <ChevronRight className="size-3" />
          </Button>
        </div>
      )}

      {/* Main Actions Group */}
      <div className="flex items-center gap-1.5 rounded-full px-1.5 py-0.5 opacity-100 transition-opacity group-hover:opacity-100 sm:opacity-0">
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

        {msg.metrics?.usedContextChunks &&
          msg.metrics.usedContextChunks.length > 0 && (
            <UsedContextButton
              chunks={msg.metrics.usedContextChunks}
              tabContextLength={msg.metrics.tabContextLength}
              ragContextLength={msg.metrics.ragContextLength}
              tabContextTruncated={msg.metrics.tabContextTruncated}
            />
          )}

        {onEdit && isUser && (
          <TooltipActionButton
            variant="ghost"
            label={isUser ? t("chat.actions.fork") : t("chat.actions.edit")}
            size="icon"
            className="size-8"
            onClick={onEdit}
            title={isUser ? t("chat.actions.fork") : t("chat.actions.edit")}
            icon={<GitFork className="size-3.5" />}
          />
        )}

        {!isUser && msg.model && !isLoading && (
          <Tooltip>
            <TooltipTrigger render={<span />}>
              <RegenerateButton
                model={msg.model}
                onSelectModel={(model) => onRegenerate?.(model)}
              />
            </TooltipTrigger>
            <TooltipContent>
              {t("chat.actions.switch_model_tooltip")}
            </TooltipContent>
          </Tooltip>
        )}

        <DropdownMenu>
          <TooltipActionButton
            trigger={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60"
                    aria-label={t("chat.actions.more")}
                  />
                }
              />
            }
            label={t("chat.actions.more")}
            icon={<MoreHorizontal className="size-3.5" />}
          />
          <DropdownMenuContent
            align={isUser ? "end" : "start"}
            sideOffset={6}
            className="w-auto rounded-lg border-muted/60 p-1.5 shadow-md data-open:animate-none data-closed:animate-none">
            {actionItems.length > 0 && (
              <DropdownMenuGroup>
                <ActionMenuGrid actions={actionItems} />
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
