import {
  Bot,
  ChevronLeft,
  ChevronRight,
  GitFork,
  MoreHorizontal,
  RefreshCcw,
  SquarePen,
  Trash2
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  type ActionMenuItemConfig,
  TooltipActionButton
} from "@/components/actions"
import { ProviderIcon } from "@/components/icons"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { ChatSessionActions } from "@/features/sessions/components/chat-session-actions"
import { buildExportActionItems } from "@/features/sessions/lib/export-action-items"
import { cn } from "@/lib/class-names"
import { BROWSER_MODEL_ID } from "@/lib/providers/browser-built-in/constants"
import { resolveModelBrand } from "@/lib/providers/provider-brand"
import { ProviderId } from "@/lib/providers/types"
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
  onEdit?: () => void
  onFork?: () => void
  onDelete?: () => void
  onExport?: (format: "json" | "pdf") => void
  onNavigate?: (nodeId: number | string) => void
}) => {
  const { t } = useTranslation()
  const [renderedAt] = useState(() => Date.now())
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
        onPdf: () => onExport("pdf"),
        onJson: () => onExport("json")
      })
    : []
  /**
   * Secondary actions sit behind the overflow menu so the visible row stays
   * Copy, Regenerate (Retry on error) and the metadata. Icons use the grid's
   * own size; the tooltip carries the name.
   */
  const secondaryItems: ActionMenuItemConfig[] = [
    ...(onEdit && isUser
      ? [
          {
            key: "edit",
            label: t("chat.actions.edit"),
            icon: <SquarePen className="icon-sm" />,
            onClick: onEdit
          }
        ]
      : []),
    ...(onFork && isUser
      ? [
          {
            key: "fork",
            label: t("chat.actions.fork"),
            icon: <GitFork className="icon-sm" />,
            onClick: onFork
          }
        ]
      : []),
    ...exportItems
  ]
  const footerButtonClass = cn(chatIconBtnCls, "[&_svg]:icon-xs")

  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center gap-x-0.5 gap-y-1 text-muted-foreground",
        isUser ? "flex-row-reverse" : "flex-row"
      )}>
      {!isUser && msg.done && <RunDetails metrics={msg.metrics} />}

      {/* Branch Navigation */}
      {canShowBranchNavigation && (
        <div className="flex h-6 shrink-0 items-center gap-0 rounded-chip bg-surface-sunken px-0">
          <TooltipActionButton
            variant="ghost"
            ariaLabel={t("chat.actions.previous_branch")}
            size="icon"
            className={chatIconBtnCls}
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
            className={chatIconBtnCls}
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
          webCitations={msg.metrics?.webCitations}
          showRetrievedChunks={showRetrievedChunks}
          feedbackEnabled={feedbackEnabled}
        />

        {!isUser && onRegenerate && !isLoading && (
          <>
            <TooltipActionButton
              variant="ghost"
              label={
                canRetry
                  ? t("common.actions.retry")
                  : t("chat.actions.regenerate")
              }
              size="icon"
              className={footerButtonClass}
              onClick={() => onRegenerate()}
              icon={<RefreshCcw className="icon-xs" />}
            />
            {msg.model && !canRetry && (
              <RegenerateButton
                model={msg.model}
                onSelectModel={(model) => onRegenerate(model)}
              />
            )}
          </>
        )}

        {(secondaryItems.length > 0 || onDelete) && (
          <ChatSessionActions
            actions={secondaryItems}
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
        <div className="ml-auto shrink-0 text-micro text-foreground-tertiary tabular-nums">
          {new Date(msg.timestamp || renderedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </div>
      ) : (
        msg.model && (
          <TooltipActionButton
            trigger={<span className="ml-auto min-w-0 max-w-full shrink" />}
            tooltip={msg.model}
            icon={
              <span className="inline-flex h-6 min-w-0 min-w-16 max-w-56 items-center gap-1 rounded-control px-1 text-micro text-foreground-tertiary hover:bg-state-hover hover:text-foreground">
                {/* The vendor the model id names, so the reply is attributed
                    with the same mark the model menu shows. */}
                {msg.model === BROWSER_MODEL_ID ? (
                  <ProviderIcon
                    providerId={ProviderId.BROWSER}
                    className="icon-xs shrink-0"
                  />
                ) : resolveModelBrand(msg.model) ? (
                  <ProviderIcon
                    brand={resolveModelBrand(msg.model)}
                    className="icon-xs shrink-0"
                  />
                ) : (
                  <Bot className="icon-xs shrink-0" />
                )}
                <span className="truncate">{msg.model}</span>
              </span>
            }
          />
        )
      )}
    </div>
  )
}
