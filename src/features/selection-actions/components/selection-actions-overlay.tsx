import type { PointerEvent as ReactPointerEvent } from "react"
import type { ProviderModel } from "@/types"
import type { SelectionActionId } from "../types"
import { SelectionPanel } from "./selection-panel"
import { SelectionToolbar } from "./selection-toolbar"

export type SelectionOverlayMode = "toolbar" | "panel"
export type SelectionPanelState = "idle" | "streaming" | "done" | "error"

interface SelectionActionsOverlayProps {
  mode: SelectionOverlayMode
  panelState: SelectionPanelState
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
  onActionChange: (actionId: SelectionActionId) => void
  onToggleMore: () => void
  onCopy: () => void
  onReplace: () => void
  onInsertBelow: () => void
  onOpenChat: () => void
  onRetry: () => void
  onCancel: () => void
  onClose: () => void
  onBack: () => void
  onTogglePin: () => void
  onCustomInstructionChange: (value: string) => void
  onRunCustom: () => void
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void
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
  onActionChange,
  onToggleMore,
  onCopy,
  onReplace,
  onInsertBelow,
  onOpenChat,
  onRetry,
  onCancel,
  onClose,
  onBack,
  onTogglePin,
  onCustomInstructionChange,
  onRunCustom,
  onDragStart
}: SelectionActionsOverlayProps) => {
  if (mode === "toolbar") {
    return (
      <SelectionToolbar
        currentAction={currentAction}
        enabledActionIds={enabledActionIds}
        isMoreMenuOpen={isMoreMenuOpen}
        tooltipContainer={tooltipContainer}
        onRunAction={onRunAction}
        onToggleMore={onToggleMore}
        onOpenChat={onOpenChat}
        onClose={onClose}
        onDragStart={onDragStart}
      />
    )
  }

  return (
    <SelectionPanel
      panelState={panelState}
      currentAction={currentAction}
      enabledActionIds={enabledActionIds}
      isThinking={isThinking}
      thinkingText={thinkingText}
      resultText={resultText}
      errorText={errorText}
      availableModels={availableModels}
      panelModel={panelModel}
      canReplace={canReplace}
      canInsert={canInsert}
      isPinned={isPinned}
      customInstruction={customInstruction}
      tooltipContainer={tooltipContainer}
      onActionChange={onActionChange}
      onModelChange={onModelChange}
      onCopy={onCopy}
      onReplace={onReplace}
      onInsertBelow={onInsertBelow}
      onOpenChat={onOpenChat}
      onRetry={onRetry}
      onCancel={onCancel}
      onClose={onClose}
      onBack={onBack}
      onTogglePin={onTogglePin}
      onCustomInstructionChange={onCustomInstructionChange}
      onRunCustom={onRunCustom}
      onDragStart={onDragStart}
    />
  )
}
