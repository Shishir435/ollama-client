import { GripHorizontal, MessageSquare, MoreHorizontal, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  type ActionConfig,
  ActionGroup,
  commandToActionConfig,
  TooltipActionButton
} from "@/components/actions"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { selectionActionCommand } from "../action-commands"
import { SELECTION_ACTIONS } from "../actions"
import { useSelectionOverlay } from "../selection-overlay-context"

export function SelectionToolbar() {
  const { t } = useTranslation()
  const {
    currentAction,
    enabledActionIds,
    isMoreMenuOpen,
    tooltipContainer,
    actions: overlayActions
  } = useSelectionOverlay()

  const actions = SELECTION_ACTIONS.filter((a) =>
    enabledActionIds.includes(a.id)
  )
  const orderedActions = (placement: "quick" | "more") =>
    actions.filter(
      (action) => selectionActionCommand(action.id).placement === placement
    )
  const quickActions = orderedActions("quick")
  const moreActions = orderedActions("more")
  const quickActionConfigs: ActionConfig[] = quickActions.map((action) =>
    commandToActionConfig({
      command: selectionActionCommand(action.id),
      t,
      labelKey: selectionActionCommand(action.id).shortLabelKey,
      variant: action.id === currentAction ? "default" : "ghost",
      size: "icon",
      onPointerDown: (e) => {
        e.preventDefault()
        e.stopPropagation()
        overlayActions.runAction(action.id)
      },
      showLabel: true,
      labelClassName: "sa-label"
    })
  )
  const toolbarActionConfigs: ActionConfig[] = [
    {
      key: "more",
      label: t("selection_button.panel.more"),
      "aria-expanded": isMoreMenuOpen,
      onPointerDown: (e) => {
        e.preventDefault()
        e.stopPropagation()
        overlayActions.toggleMore()
      },
      icon: MoreHorizontal,
      showLabel: true,
      labelClassName: "sa-label"
    },
    {
      key: "open-chat",
      label: t("selection_button.panel.open_chat"),
      onPointerDown: (e) => {
        e.preventDefault()
        e.stopPropagation()
        overlayActions.openChat()
      },
      icon: MessageSquare,
      showLabel: true,
      labelClassName: "sa-label"
    },
    {
      key: "close",
      label: t("selection_button.panel.close"),
      onPointerDown: (e) => {
        e.preventDefault()
        e.stopPropagation()
        overlayActions.close()
      },
      icon: X
    }
  ]

  return (
    <TooltipProvider>
      <div className="sa-toolbar" role="toolbar" aria-label="Selection actions">
        <div className="sa-toolbar-strip">
          <TooltipActionButton
            trigger={
              <div
                className="sa-drag-handle sa-toolbar-drag"
                onPointerDown={overlayActions.startDrag}
              />
            }
            icon={GripHorizontal}
            label={t("selection_button.panel.drag_toolbar")}
            tooltipContainer={tooltipContainer}
          />

          <ActionGroup
            actions={quickActionConfigs}
            tooltipContainer={tooltipContainer}
            wrap={false}
          />

          <ActionGroup
            actions={toolbarActionConfigs}
            tooltipContainer={tooltipContainer}
            wrap={false}
          />
        </div>

        {isMoreMenuOpen && (
          <div className="sa-menu" role="menu">
            {moreActions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="ghost"
                size="sm"
                className="sa-menu-item"
                aria-label={t(
                  `selection_button.actions.${action.id}.label`,
                  action.label
                )}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  overlayActions.runAction(action.id)
                }}>
                {t(`selection_button.actions.${action.id}.label`, action.label)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
