import type { PointerEvent as ReactPointerEvent } from "react"
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
  const actions = SELECTION_ACTIONS.filter((a) =>
    enabledActionIds.includes(a.id)
  )
  const quickActions = QUICK_ACTION_IDS.map((id) =>
    actions.find((a) => a.id === id)
  ).filter(Boolean)
  const moreActions = MORE_ACTION_IDS.map((id) =>
    actions.find((a) => a.id === id)
  ).filter(Boolean)

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
              Drag toolbar
            </TooltipContent>
          </Tooltip>

          {quickActions.map((action) => (
            <Tooltip key={action.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={`sa-button ${action.id === currentAction ? "primary" : ""}`}
                    aria-label={action.label}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onRunAction(action.id)
                    }}
                  />
                }>
                {iconForAction(action.id)}
                <span className="sa-label">{action.shortLabel}</span>
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                {action.label}
              </TooltipContent>
            </Tooltip>
          ))}

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="sa-button"
                  aria-label="More actions"
                  aria-expanded={isMoreMenuOpen}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onToggleMore()
                  }}
                />
              }>
              <MoreHorizontal aria-hidden="true" />
              <span className="sa-label">More</span>
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              More actions
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="sa-button"
                  aria-label="Open in Chat"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onOpenChat()
                  }}
                />
              }>
              <MessageSquare aria-hidden="true" />
              <span className="sa-label">Open in Chat</span>
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>
              Open in Chat
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="sa-button"
                  aria-label="Close"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onClose()
                  }}
                />
              }>
              <X aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent container={tooltipContainer}>Close</TooltipContent>
          </Tooltip>
        </div>

        {isMoreMenuOpen && (
          <div className="sa-menu" role="menu">
            {moreActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className="sa-button sa-menu-item"
                aria-label={action.label}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onRunAction(action.id)
                }}>
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
