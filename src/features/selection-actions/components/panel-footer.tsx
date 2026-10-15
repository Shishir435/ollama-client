import { Check, Copy, MessageSquare, RefreshCw, SquarePen } from "lucide-react"
import { useTranslation } from "react-i18next"
import { type ActionConfig, ActionGroup } from "@/components/actions"
import { useSelectionOverlay } from "../selection-overlay-context"

export function PanelFooter() {
  const { t } = useTranslation()
  const {
    panelState,
    resultText,
    canReplace,
    canInsert,
    notice,
    tooltipContainer,
    actions
  } = useSelectionOverlay()

  const copied = notice === "copied"
  const utilityActions: ActionConfig[] = [
    {
      key: "copy",
      variant: "outline",
      size: copied ? "default" : "icon",
      label: copied
        ? t("selection_button.panel.copied")
        : t("selection_button.panel.copy"),
      showLabel: copied,
      disabled: !resultText.trim(),
      onClick: actions.copy,
      icon: copied ? Check : Copy
    },
    {
      key: "retry",
      variant: "outline",
      size: "icon",
      label: t("selection_button.panel.retry"),
      disabled: panelState === "streaming",
      onClick: actions.retry,
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
      onClick: actions.insertBelow
    },
    {
      key: "open-chat",
      variant: "outline",
      size: "default",
      label: t("selection_button.panel.open_chat"),
      tooltip: t("selection_button.panel.open_chat_tip"),
      disabled: !resultText.trim(),
      onClick: actions.openChat,
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
      onClick: actions.replace,
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
      onClick: actions.cancel,
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
