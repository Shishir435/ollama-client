import { useTranslation } from "react-i18next"

import {
  ActionGroup,
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
  Bot,
  ChevronLeft,
  ChevronRight,
  Code,
  FileDown,
  FileText,
  GitFork,
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
  const footerButtonClass =
    "size-7 rounded-control text-muted-foreground hover:bg-muted/55 hover:text-foreground"

  return (
    <div
      className={
        "flex w-full items-center gap-2 text-muted-foreground " +
        (isUser ? "flex-row-reverse" : "flex-row")
      }>
      {/* Branch Navigation */}
      {canShowBranchNavigation && (
        <div className="flex h-7 items-center gap-0.5 rounded-chip bg-background/45 px-0.5">
          <TooltipActionButton
            variant="ghost"
            ariaLabel={t("chat.actions.previous_branch", "Previous branch")}
            size="icon"
            className="size-6 rounded-control"
            disabled={siblingIndex <= 0}
            onClick={() => {
              if (siblingIndex > 0) navigateToSibling(siblingIndex - 1)
            }}
            icon={<ChevronLeft className="size-3.5" />}
          />
          <span className="min-w-6 text-center text-[10px] font-medium text-muted-foreground">
            {siblingIndex + 1} / {siblingIds.length}
          </span>
          <TooltipActionButton
            variant="ghost"
            ariaLabel={t("chat.actions.next_branch", "Next branch")}
            size="icon"
            className="size-6 rounded-control"
            disabled={siblingIndex >= siblingIds.length - 1}
            onClick={() => {
              if (siblingIndex < siblingIds.length - 1)
                navigateToSibling(siblingIndex + 1)
            }}
            icon={<ChevronRight className="size-3.5" />}
          />
        </div>
      )}

      {/* Main Actions Group */}
      <div className="flex min-h-7 items-center gap-1 rounded-chip bg-background/35 px-1 opacity-100 transition-opacity group-hover:opacity-100 sm:opacity-0">
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
            icon={<GitFork className="size-4" />}
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

        {onExport && (
          <DropdownMenu>
            <TooltipActionButton
              trigger={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className={footerButtonClass}
                      aria-label={t("chat.actions.export", "Export")}
                    />
                  }
                />
              }
              label={t("chat.actions.export", "Export")}
              icon={<FileDown className="size-4" />}
            />
            <DropdownMenuContent
              align={isUser ? "end" : "start"}
              sideOffset={6}
              className="w-auto rounded-panel border-muted/60 p-1.5 shadow-md data-open:animate-none data-closed:animate-none">
              <DropdownMenuGroup>
                <ActionMenuGrid
                  actions={actionItems.filter((item) => item.key !== "delete")}
                />
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <ActionGroup
          wrap={false}
          actions={[
            {
              key: "delete",
              hidden: !onDelete,
              label: t("chat.actions.delete"),
              className: footerButtonClass,
              onClick: () => onDelete?.(),
              icon: <Trash2 className="size-4" />
            }
          ]}
        />
      </div>

      {isUser ? (
        <div className="ml-auto text-[10px] text-muted-foreground/55 tabular-nums">
          {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </div>
      ) : (
        msg.model && (
          <Tooltip>
            <TooltipTrigger render={<span />}>
              <span className="ml-auto inline-flex h-7 max-w-40 items-center gap-1 rounded-chip bg-background/35 px-2 text-[10px] text-muted-foreground/70">
                <Bot className="size-3.5 shrink-0" />
                <span className="truncate">{msg.model}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{msg.model}</TooltipContent>
          </Tooltip>
        )
      )}
    </div>
  )
}
