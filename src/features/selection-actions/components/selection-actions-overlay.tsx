import type { PointerEvent as ReactPointerEvent } from "react"
import { useEffect, useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import {
  Copy,
  GripHorizontal,
  HelpCircle,
  MessageSquare,
  MoreHorizontal,
  Pin,
  RefreshCw,
  Scissors,
  Sparkles,
  SquarePen,
  X
} from "@/lib/lucide-icon"
import type { ProviderModel } from "@/types"
import { SELECTION_ACTIONS } from "../actions"
import type { SelectionActionId } from "../types"

export type SelectionOverlayMode = "toolbar" | "panel"
export type SelectionPanelState = "idle" | "streaming" | "done" | "error"

interface SelectionActionsOverlayProps {
  mode: SelectionOverlayMode
  panelState: SelectionPanelState
  appIconUrl: string
  currentAction: SelectionActionId
  enabledActionIds: SelectionActionId[]
  isMoreMenuOpen: boolean
  resultText: string
  errorText: string
  isThinking: boolean
  thinkingText: string
  availableModels: ProviderModel[]
  panelModel: string
  onModelChange: (model: string, providerId?: string) => void
  canReplace: boolean
  canInsert: boolean
  tooltipContainer: HTMLElement | ShadowRoot | null
  isPinned: boolean
  customInstruction: string
  onRunAction: (actionId: SelectionActionId) => void
  onToggleMore: () => void
  onCopy: () => void
  onReplace: () => void
  onInsertBelow: () => void
  onOpenChat: () => void
  onRetry: () => void
  onCancel: () => void
  onClose: () => void
  onTogglePin: () => void
  onCustomInstructionChange: (value: string) => void
  onRunCustom: () => void
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void
}

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

export const SelectionActionsOverlay = ({
  mode,
  panelState,
  currentAction,
  enabledActionIds,
  isMoreMenuOpen,
  resultText,
  errorText,
  isThinking,
  thinkingText,
  availableModels,
  panelModel,
  onModelChange,
  canReplace,
  canInsert,
  tooltipContainer,
  isPinned,
  customInstruction,
  onRunAction,
  onToggleMore,
  onCopy,
  onReplace,
  onInsertBelow,
  onOpenChat,
  onRetry,
  onCancel,
  onClose,
  onTogglePin,
  onCustomInstructionChange,
  onRunCustom,
  onDragStart
}: SelectionActionsOverlayProps) => {
  const [thinkingExpanded, setThinkingExpanded] = useState(false)

  useEffect(() => {
    if (isThinking) {
      setThinkingExpanded(true)
    } else if (thinkingText) {
      setThinkingExpanded(false)
    }
  }, [isThinking, thinkingText])

  const actions = SELECTION_ACTIONS.filter((action) =>
    enabledActionIds.includes(action.id)
  )
  const selectedAction =
    SELECTION_ACTIONS.find((action) => action.id === currentAction) ||
    SELECTION_ACTIONS[0]

  if (mode === "toolbar") {
    const quickActions = QUICK_ACTION_IDS.map((id) =>
      actions.find((action) => action.id === id)
    ).filter(Boolean)
    const moreActions = MORE_ACTION_IDS.map((id) =>
      actions.find((action) => action.id === id)
    ).filter(Boolean)

    return (
      <TooltipProvider>
        <div
          className="sa-toolbar"
          role="toolbar"
          aria-label="Selection actions">
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
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
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
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
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
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
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
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onClose()
                    }}
                  />
                }>
                <X aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                Close
              </TooltipContent>
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
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
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

  const body =
    panelState === "error" ? (
      <div className="sa-result sa-error">{errorText}</div>
    ) : (
      <div className="sa-result">
        {resultText || (
          <span className="sa-muted">
            {isThinking ? "Thinking…" : "Working…"}
          </span>
        )}
      </div>
    )

  const thinkingSection = thinkingText ? (
    <div className="sa-thinking-section">
      <button
        type="button"
        className="sa-thinking-header"
        onClick={() => setThinkingExpanded((v) => !v)}>
        {isThinking ? (
          <span className="sa-thinking-pulse" aria-hidden="true" />
        ) : (
          <span className="sa-thinking-chevron">
            {thinkingExpanded ? "▾" : "▸"}
          </span>
        )}
        <span className="sa-thinking-label">
          {isThinking ? "Reasoning…" : "Reasoning"}
        </span>
        {!isThinking && (
          <span className="sa-thinking-chevron sa-thinking-chevron-end">
            {thinkingExpanded ? "▾" : "▸"}
          </span>
        )}
      </button>
      {thinkingExpanded && (
        <div className="sa-thinking-body">{thinkingText}</div>
      )}
    </div>
  ) : null

  const modelSelector =
    availableModels.length > 0 ? (
      <select
        className="sa-model-inline"
        value={panelModel}
        onChange={(e) => {
          const m = availableModels.find((x) => x.model === e.target.value)
          onModelChange(e.target.value, m?.providerId)
        }}>
        {panelModel && !availableModels.find((m) => m.model === panelModel) && (
          <option value={panelModel}>{panelModel}</option>
        )}
        {availableModels.map((m) => (
          <option key={m.model} value={m.model}>
            {m.name || m.model}
          </option>
        ))}
      </select>
    ) : panelModel ? (
      <span className="sa-model-name sa-muted">{panelModel}</span>
    ) : null

  return (
    <TooltipProvider>
      <div
        className="sa-panel"
        role="dialog"
        aria-label="Selection action result">
        <div className="sa-panel-header">
          <div className="sa-title-wrap">
            <Tooltip>
              <TooltipTrigger
                render={
                  <div className="sa-drag-handle" onPointerDown={onDragStart} />
                }>
                <GripHorizontal aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                Drag panel
              </TooltipContent>
            </Tooltip>
            <div className="sa-title-meta">
              <div className="sa-title">{selectedAction.label}</div>
              {modelSelector && (
                <div className="sa-model-row">{modelSelector}</div>
              )}
            </div>
          </div>
          <div className="sa-header-actions">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={`sa-button ${isPinned ? "primary" : ""}`}
                    aria-label={isPinned ? "Unpin panel" : "Pin panel"}
                    onClick={onTogglePin}
                  />
                }>
                <Pin aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                {isPinned ? "Unpin panel" : "Pin panel"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="sa-button"
                    aria-label="Close"
                    onClick={onClose}
                  />
                }>
                <X aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                Close
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        {currentAction === "custom" && panelState === "idle" && (
          <form
            className="sa-custom-row"
            onSubmit={(event) => {
              event.preventDefault()
              onRunCustom()
            }}>
            <input
              className="sa-input"
              aria-label="Custom prompt instruction"
              placeholder="Instruction"
              value={customInstruction}
              onChange={(event) =>
                onCustomInstructionChange(event.target.value)
              }
            />
            <Tooltip>
              <TooltipTrigger
                render={<button type="submit" className="sa-button primary" />}>
                Run
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                Run custom prompt
              </TooltipContent>
            </Tooltip>
          </form>
        )}
        {thinkingSection}
        {body}
        <div className="sa-panel-actions">
          <div className="sa-action-group">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="sa-button outline icon-only"
                    aria-label="Copy result"
                    disabled={!resultText.trim()}
                    onClick={onCopy}
                  />
                }>
                <Copy aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                Copy result
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="sa-button outline icon-only"
                    aria-label="Retry action"
                    disabled={panelState === "streaming"}
                    onClick={onRetry}
                  />
                }>
                <RefreshCw aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                Retry action
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="sa-action-group apply-group">
            {canInsert && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="sa-button outline"
                      onClick={onInsertBelow}
                    />
                  }>
                  Insert Below
                </TooltipTrigger>
                <TooltipContent container={tooltipContainer}>
                  Insert result below selection
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="sa-button outline primary"
                    disabled={!resultText.trim()}
                    onClick={onOpenChat}
                  />
                }>
                <MessageSquare aria-hidden="true" />
                Open in Chat
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer}>
                Open result in chat
              </TooltipContent>
            </Tooltip>
            {canReplace && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="sa-button fill"
                      onClick={onReplace}
                    />
                  }>
                  <SquarePen aria-hidden="true" />
                  Replace
                </TooltipTrigger>
                <TooltipContent container={tooltipContainer}>
                  Replace selected text
                </TooltipContent>
              </Tooltip>
            )}
            {panelState === "streaming" && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="sa-button danger"
                      onClick={onCancel}
                    />
                  }>
                  Cancel
                </TooltipTrigger>
                <TooltipContent container={tooltipContainer}>
                  Cancel generation
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
