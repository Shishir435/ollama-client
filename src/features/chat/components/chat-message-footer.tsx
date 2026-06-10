import { useTranslation } from "react-i18next"

import {
  type ActionMenuItemConfig,
  TooltipActionButton
} from "@/components/actions"
import { SimpleTooltip } from "@/components/ui/simple-tooltip"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { ChatSessionActions } from "@/features/sessions/components/chat-session-actions"
import {
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  Code,
  FileDown,
  FileText,
  GitFork,
  Trash2
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"
import { CopyButton } from "./copy-button"
import { RAGSourcesButton } from "./rag-sources-button"
import { RegenerateButton } from "./regenerate-button"
import { RunDetails } from "./run-details"
import { SpeechButton } from "./speech-button"
import { UsedContextButton } from "./used-context-button"

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
          icon: <BookOpen className="icon-xs" />
        }
      : null,
    onExport
      ? {
          key: "pdf",
          label: "PDF",
          onClick: () => onExport("pdf"),
          icon: <FileDown className="icon-xs" />
        }
      : null,
    onExport
      ? {
          key: "json",
          label: "JSON",
          onClick: () => onExport("json"),
          icon: <Code className="icon-xs" />
        }
      : null,
    onExport
      ? {
          key: "text",
          label: "Text",
          onClick: () => onExport("text"),
          icon: <FileText className="icon-xs" />
        }
      : null,
    onDelete
      ? {
          key: "delete",
          label: t("chat.actions.delete"),
          onClick: () => onDelete(),
          icon: <Trash2 className="icon-xs" />,
          destructive: true
        }
      : null
  ].filter(Boolean) as ActionMenuItemConfig[]
  const footerButtonClass = cn(chatIconBtnCls, "[&_svg]:icon-xs")

  return (
    <div
      className={cn(
        "flex w-full flex-nowrap items-center gap-0.5 text-muted-foreground",
        isUser ? "flex-row-reverse" : "flex-row"
      )}>
      {!isUser && msg.done && <RunDetails metrics={msg.metrics} />}

      {/* Branch Navigation */}
      {canShowBranchNavigation && (
        <div className="flex h-6 shrink-0 items-center gap-0 rounded-chip bg-background/45 px-0">
          <TooltipActionButton
            variant="ghost"
            ariaLabel={t("chat.actions.previous_branch")}
            size="icon"
            className="size-5 rounded-control"
            disabled={siblingIndex <= 0}
            onClick={() => {
              if (siblingIndex > 0) navigateToSibling(siblingIndex - 1)
            }}
            icon={<ChevronLeft className="icon-xs" />}
          />
          <span className="min-w-5 whitespace-nowrap text-center text-[10px] font-medium text-muted-foreground">
            {siblingIndex + 1} / {siblingIds.length}
          </span>
          <TooltipActionButton
            variant="ghost"
            ariaLabel={t("chat.actions.next_branch")}
            size="icon"
            className="size-5 rounded-control"
            disabled={siblingIndex >= siblingIds.length - 1}
            onClick={() => {
              if (siblingIndex < siblingIds.length - 1)
                navigateToSibling(siblingIndex + 1)
            }}
            icon={<ChevronRight className="icon-xs" />}
          />
        </div>
      )}

      {/* Main Actions Group */}
      <div className="flex min-h-6 min-w-0 shrink items-center gap-0 rounded-chip px-0 opacity-100 transition-opacity group-hover:opacity-100">
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
            className={footerButtonClass}
            onClick={onEdit}
            icon={<GitFork className="icon-xs" />}
          />
        )}

        {!isUser && msg.model && !isLoading && (
          <SimpleTooltip content={t("chat.actions.switch_model_tooltip")}>
            <RegenerateButton
              model={msg.model}
              onSelectModel={(model) => onRegenerate?.(model)}
            />
          </SimpleTooltip>
        )}

        {actionItems.length > 0 && <ChatSessionActions actions={actionItems} />}
      </div>

      {isUser ? (
        <div className="ml-auto shrink-0 text-[10px] text-muted-foreground/55 tabular-nums">
          {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </div>
      ) : (
        msg.model && (
          <SimpleTooltip
            content={msg.model}
            triggerRender={<span className="ml-auto min-w-0 shrink" />}>
            <span className="inline-flex h-6 min-w-0 max-w-[clamp(5rem,24vw,14rem)] items-center gap-1 rounded-control px-1 text-[10px] text-muted-foreground/70 hover:bg-muted/35 hover:text-foreground">
              <Bot className="icon-xs shrink-0" />
              <span className="truncate">{msg.model}</span>
            </span>
          </SimpleTooltip>
        )
      )}
    </div>
  )
}
