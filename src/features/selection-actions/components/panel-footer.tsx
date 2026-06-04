import { useTranslation } from "react-i18next"
import { type ActionConfig, ActionGroup } from "@/components/actions"
import { Copy, MessageSquare, RefreshCw, SquarePen } from "@/lib/lucide-icon"
import type { SelectionPanelState } from "./selection-actions-overlay"

interface PanelFooterProps {
  panelState: SelectionPanelState
  resultText: string
  canReplace: boolean
  canInsert: boolean
  tooltipContainer: HTMLElement | ShadowRoot | null
  onCopy: () => void
  onRetry: () => void
  onReplace: () => void
  onInsertBelow: () => void
  onOpenChat: () => void
  onCancel: () => void
}

export function PanelFooter({
  panelState,
  resultText,
  canReplace,
  canInsert,
  tooltipContainer,
  onCopy,
  onRetry,
  onReplace,
  onInsertBelow,
  onOpenChat,
  onCancel
}: PanelFooterProps) {
  const { t } = useTranslation()
  const utilityActions: ActionConfig[] = [
    {
      key: "copy",
      variant: "outline",
      size: "icon",
      label: t("selection_button.panel.copy"),
      disabled: !resultText.trim(),
      onClick: onCopy,
      icon: Copy
    },
    {
      key: "retry",
      variant: "outline",
      size: "icon",
      label: t("selection_button.panel.retry"),
      disabled: panelState === "streaming",
      onClick: onRetry,
      icon: RefreshCw
    }
  ]
  const applyActions: ActionConfig[] = [
    {
      key: "insert",
      hidden: !canInsert,
      variant: "outline",
      size: "default",
      label: t("selection_button.panel.insert"),
      tooltip: t("selection_button.panel.insert_tip"),
      showLabel: true,
      onClick: onInsertBelow
    },
    {
      key: "open-chat",
      variant: "outline",
      size: "default",
      label: t("selection_button.panel.open_chat"),
      tooltip: t("selection_button.panel.open_chat_tip"),
      disabled: !resultText.trim(),
      onClick: onOpenChat,
      icon: MessageSquare,
      showLabel: true
    },
    {
      key: "replace",
      hidden: !canReplace,
      variant: "default",
      size: "default",
      label: t("selection_button.panel.replace"),
      tooltip: t("selection_button.panel.replace_tip"),
      onClick: onReplace,
      icon: SquarePen,
      showLabel: true
    },
    {
      key: "cancel",
      hidden: panelState !== "streaming",
      variant: "destructive",
      size: "default",
      label: t("selection_button.panel.cancel"),
      tooltip: t("selection_button.panel.cancel_tip"),
      onClick: onCancel,
      showLabel: true
    }
  ]

  return (
    <div className="sa-panel-actions">
      <ActionGroup
        actions={utilityActions}
        className="sa-action-group"
        defaultVariant="outline"
        tooltipContainer={tooltipContainer}
      />

      <ActionGroup
        actions={applyActions}
        className="sa-action-group apply-group"
        tooltipContainer={tooltipContainer}
      />
    </div>
  )
}
