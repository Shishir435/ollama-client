import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { ChatSessionActions } from "@/features/sessions/components/chat-session-actions"
import { buildExportActionItems } from "@/features/sessions/lib/export-action-items"
import { buildErrorReportUrl } from "@/lib/error-report"
import {
  Bot,
  Bug,
  ChevronLeft,
  ChevronRight,
  GitFork,
  MoreHorizontal,
  RefreshCcw,
  SquarePen,
  Trash2
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/types"
import { CopyButton } from "./copy-button"
import { RegenerateButton } from "./regenerate-button"
import { RunDetails } from "./run-details"
import { SpeechButton } from "./speech-button"
import { UnifiedSourcesButton } from "./unified-sources-button"

export const ChatMessageFooter = ({
  msg,
  isUser,
  isLoading,
  showRetrievedChunks = true,
  feedbackEnabled = true,
  onRegenerate,
  canRetry,
  canReport,
  onEdit,
  onFork,
  onDelete,
  onExport,
  onNavigate
}: {
  msg: ChatMessage
  isUser: boolean
  isLoading?: boolean
  showRetrievedChunks?: boolean
  feedbackEnabled?: boolean
  onRegenerate?: (model?: string) => void
  canRetry?: boolean
  canReport?: boolean
  onEdit?: () => void
  onFork?: () => void
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

  const exportItems = onExport
    ? buildExportActionItems(t, {
        onMarkdown: () => onExport("markdown"),
        onPdf: () => onExport("pdf"),
        onJson: () => onExport("json"),
        onText: () => onExport("text")
      })
    : []
  const reportUrl = canReport
    ? buildErrorReportUrl({
        status: msg.error?.status,
        kind: msg.error?.kind,
        message: msg.content
      })
    : null
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
          <span className="min-w-5 whitespace-nowrap text-center text-micro font-medium text-muted-foreground">
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

        <UnifiedSourcesButton
          ragSources={msg.metrics?.ragSources}
          ragQuery={msg.metrics?.ragQuery}
          usedContextChunks={msg.metrics?.usedContextChunks}
          toolRuns={msg.metrics?.toolRuns}
          showRetrievedChunks={showRetrievedChunks}
          feedbackEnabled={feedbackEnabled}
        />

        {onEdit && isUser && (
          <TooltipActionButton
            variant="ghost"
            label={t("chat.actions.edit")}
            size="icon"
            className={footerButtonClass}
            onClick={onEdit}
            icon={<SquarePen className="icon-xs" />}
          />
        )}

        {onFork && isUser && (
          <TooltipActionButton
            variant="ghost"
            label={t("chat.actions.fork")}
            size="icon"
            className={footerButtonClass}
            onClick={onFork}
            icon={<GitFork className="icon-xs" />}
          />
        )}

        {!isUser && msg.model && !isLoading && (
          <TooltipActionButton
            trigger={<span />}
            tooltip={t("chat.actions.switch_model_tooltip")}
            icon={
              <RegenerateButton
                model={msg.model}
                onSelectModel={(model) => onRegenerate?.(model)}
              />
            }
          />
        )}

        {!isUser && canRetry && (
          <TooltipActionButton
            variant="ghost"
            label={t("common.actions.retry")}
            size="icon"
            className={footerButtonClass}
            onClick={() => onRegenerate?.()}
            icon={<RefreshCcw className="icon-xs" />}
          />
        )}

        {!isUser && reportUrl && (
          <TooltipActionButton
            trigger={
              // biome-ignore lint/a11y/useAnchorContent: children are forwarded by Base UI's render-prop merge at runtime
              <a
                href={reportUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  footerButtonClass,
                  "inline-flex items-center justify-center"
                )}
                aria-label={t("chat.errors.report_issue")}
              />
            }
            icon={<Bug className="icon-xs" />}
            label={t("chat.errors.report_issue")}
          />
        )}

        {(exportItems.length > 0 || onDelete) && (
          <ChatSessionActions
            actions={exportItems}
            destructiveAction={
              onDelete
                ? {
                    label: t("chat.actions.delete"),
                    ariaLabel: t("chat.actions.delete"),
                    icon: <Trash2 className="icon-sm" />,
                    onClick: onDelete
                  }
                : undefined
            }
            trigger={{
              ariaLabel: t("chat.actions.more"),
              tooltip: t("chat.actions.more"),
              icon: <MoreHorizontal className="icon-xs" />,
              className: footerButtonClass
            }}
          />
        )}
      </div>

      {isUser ? (
        <div className="ml-auto shrink-0 text-micro text-muted-foreground/55 tabular-nums">
          {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </div>
      ) : (
        msg.model && (
          <TooltipActionButton
            trigger={<span className="ml-auto min-w-0 shrink" />}
            tooltip={msg.model}
            icon={
              <span className="inline-flex h-6 min-w-0 max-w-[clamp(5rem,24vw,14rem)] items-center gap-1 rounded-control px-1 text-micro text-muted-foreground/70 hover:bg-muted/35 hover:text-foreground">
                <Bot className="icon-xs shrink-0" />
                <span className="truncate">{msg.model}</span>
              </span>
            }
          />
        )
      )}
    </div>
  )
}
