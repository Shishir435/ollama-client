import type { PointerEvent as ReactPointerEvent } from "react"
import { useTranslation } from "react-i18next"
import { type ActionConfig, ActionGroup } from "@/components/actions"
import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import {
  GripHorizontal,
  HelpCircle,
  MessageSquare,
  MoreHorizontal,
  Scissors,
  Sparkles,
  SquarePen,
  X
} from "@/lib/lucide-icon"
import { SELECTION_ACTIONS } from "../actions"
import type { SelectionActionId } from "../types"

const QUICK_ACTION_IDS: SelectionActionId[] = [
  "summarize",
  "rewrite",
  "explain"
]
const MORE_ACTION_IDS: SelectionActionId[] = [
  "shorten",
  "fix-grammar",
  "translate-english",
  "action-items",
  "custom"
]

const iconForAction = (actionId: SelectionActionId) => {
  if (actionId === "rewrite") return <SquarePen aria-hidden="true" />
  if (actionId === "explain") return <HelpCircle aria-hidden="true" />
  if (actionId === "shorten") return <Scissors aria-hidden="true" />
  return <Sparkles aria-hidden="true" />
}

interface SelectionToolbarProps {
  currentAction: SelectionActionId
  enabledActionIds: SelectionActionId[]
  isMoreMenuOpen: boolean
  tooltipContainer: HTMLElement | ShadowRoot | null
  onRunAction: (actionId: SelectionActionId) => void
  onToggleMore: () => void
  onOpenChat: () => void
  onClose: () => void
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void
}

export function SelectionToolbar({
  currentAction,
  enabledActionIds,
  isMoreMenuOpen,
  tooltipContainer,
  onRunAction,
  onToggleMore,
  onOpenChat,
  onClose,
  onDragStart
}: SelectionToolbarProps) {
  const { t } = useTranslation()
  const actions = SELECTION_ACTIONS.filter((a) =>
    enabledActionIds.includes(a.id)
  )
  const quickActions = QUICK_ACTION_IDS.map((id) =>
    actions.find((a) => a.id === id)
  ).filter(Boolean)
  const moreActions = MORE_ACTION_IDS.map((id) =>
    actions.find((a) => a.id === id)
  ).filter(Boolean)
  const quickActionConfigs: ActionConfig[] = quickActions.map((action) => ({
    key: action.id,
    variant: action.id === currentAction ? "default" : "ghost",
    size: "icon",
    label: t(`selection_button.actions.${action.id}.short`, action.shortLabel),
    ariaLabel: t(`selection_button.actions.${action.id}.label`, action.label),
    tooltip: t(`selection_button.actions.${action.id}.label`, action.label),
    onPointerDown: (e) => {
      e.preventDefault()
      e.stopPropagation()
      onRunAction(action.id)
    },
    icon: iconForAction(action.id),
    showLabel: true
  }))
  const toolbarActionConfigs: ActionConfig[] = [
    {
      key: "more",
      label: t("selection_button.panel.more"),
      "aria-expanded": isMoreMenuOpen,
      onPointerDown: (e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggleMore()
      },
      icon: MoreHorizontal,
      showLabel: true
    },
    {
      key: "open-chat",
      label: t("selection_button.panel.open_chat"),
      onPointerDown: (e) => {
        e.preventDefault()
        e.stopPropagation()
        onOpenChat()
      },
      icon: MessageSquare,
      showLabel: true
    },
    {
      key: "close",
      label: t("selection_button.panel.close"),
      onPointerDown: (e) => {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      },
      icon: X
    }
  ]

  return (
    <TooltipProvider>
      <div className="sa-toolbar" role="toolbar" aria-label="Selection actions">
        <div className="sa-toolbar-strip">
          <Tooltip>
            <TooltipTrigger
              render={
                <div
                  className="sa-drag-handle sa-toolbar-drag"
                  onPointerDown={onDragStart}
                />
              }>
              <GripHorizontal aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              {t("selection_button.panel.drag_toolbar")}
            </TooltipContent>
          </Tooltip>

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
              <button
                key={action.id}
                type="button"
                className={
                  buttonVariants({ variant: "ghost", size: "sm" }) +
                  " sa-menu-item"
                }
                aria-label={t(
                  `selection_button.actions.${action.id}.label`,
                  action.label
                )}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onRunAction(action.id)
                }}>
                {t(`selection_button.actions.${action.id}.label`, action.label)}
              </button>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
