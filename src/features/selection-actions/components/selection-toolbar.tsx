import { GripHorizontal, MessageSquare, X } from "lucide-react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { useTranslation } from "react-i18next"
import {
  type ActionConfig,
  ActionGroup,
  commandToActionConfig,
  TooltipActionButton
} from "@/components/actions"
import { TooltipProvider } from "@/components/ui/tooltip"
import { selectionActionCommand } from "../action-commands"
import { SELECTION_ACTIONS } from "../actions"
import { useSelectionOverlay } from "../selection-overlay-context"
import type { SelectionActionId } from "../types"
import { DragHandle } from "./drag-handle"

/**
 * Pressing a toolbar button must not move focus or collapse the page
 * selection the action is about to read, so pointerdown is swallowed. The
 * action itself runs on click, which Enter and Space also produce.
 */
const keepPageSelection = (event: ReactPointerEvent<HTMLElement>) => {
  event.preventDefault()
  event.stopPropagation()
}

export function SelectionToolbar() {
  const { t } = useTranslation()
  const {
    currentAction,
    enabledActionIds,
    isOpeningChat,
    notice,
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
      onPointerDown: keepPageSelection,
      onClick: () => overlayActions.runAction(action.id),
      showLabel: true,
      labelClassName: "sa-label"
    })
  )
  const toolbarActionConfigs: ActionConfig[] = [
    {
      key: "open-chat",
      disabled: isOpeningChat,
      label: t("selection_button.panel.open_chat"),
      onPointerDown: keepPageSelection,
      onClick: () => overlayActions.openChat(),
      icon: MessageSquare,
      showLabel: true,
      labelClassName: "sa-label"
    },
    {
      key: "close",
      label: t("selection_button.panel.close"),
      onPointerDown: keepPageSelection,
      onClick: () => overlayActions.close(),
      icon: X
    }
  ]

  return (
    <TooltipProvider>
      <div
        className="sa-toolbar"
        role="toolbar"
        aria-keyshortcuts="Alt+Shift+Period"
        aria-label={t("selection_button.panel.toolbar_label")}>
        <div className="sa-toolbar-strip">
          <TooltipActionButton
            trigger={
              <DragHandle
                className="sa-drag-handle sa-toolbar-drag"
                label={t("selection_button.panel.drag_toolbar")}
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

          {moreActions.length > 0 && (
            <select
              className="sa-model-inline sa-more-select"
              aria-label={t("selection_button.panel.more")}
              value=""
              onChange={(event) =>
                overlayActions.runAction(
                  event.target.value as SelectionActionId
                )
              }>
              <option value="" disabled>
                {t("selection_button.panel.more")}
              </option>
              {moreActions.map((action) => (
                <option key={action.id} value={action.id}>
                  {t(`selection_button.actions.${action.id}.label`)}
                </option>
              ))}
            </select>
          )}

          <ActionGroup
            actions={toolbarActionConfigs}
            tooltipContainer={tooltipContainer}
            wrap={false}
          />
        </div>
        {notice === "open_chat_failed" && (
          <p className="sa-notice sa-error" role="alert">
            {t("selection_button.panel.open_chat_failed")}
          </p>
        )}
      </div>
    </TooltipProvider>
  )
}
