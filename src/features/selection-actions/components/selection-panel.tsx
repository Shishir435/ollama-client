import type { PointerEvent as ReactPointerEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { ProviderModel } from "@/types"
import { SELECTION_ACTIONS } from "../actions"
import type { SelectionActionId } from "../types"
import { PanelFooter } from "./panel-footer"
import { PanelHeader } from "./panel-header"
import { PanelThinking } from "./panel-thinking"
import type { SelectionPanelState } from "./selection-actions-overlay"

interface SelectionPanelProps {
  panelState: SelectionPanelState
  currentAction: SelectionActionId
  isThinking: boolean
  thinkingText: string
  resultText: string
  errorText: string
  availableModels: ProviderModel[]
  panelModel: string
  canReplace: boolean
  canInsert: boolean
  isPinned: boolean
  customInstruction: string
  tooltipContainer: HTMLElement | ShadowRoot | null
  onModelChange: (model: string, providerId?: string) => void
  onRunAction: (actionId: SelectionActionId) => void
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

export function SelectionPanel({
  panelState,
  currentAction,
  isThinking,
  thinkingText,
  resultText,
  errorText,
  availableModels,
  panelModel,
  canReplace,
  canInsert,
  isPinned,
  customInstruction,
  tooltipContainer,
  onModelChange,
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
}: SelectionPanelProps) {
  const selectedAction =
    SELECTION_ACTIONS.find((a) => a.id === currentAction) ??
    SELECTION_ACTIONS[0]

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

  return (
    <TooltipProvider>
      <Card
        className="sa-panel-card"
        role="dialog"
        aria-label="Selection action result">
        <CardHeader className="sa-card-header">
          <PanelHeader
            actionLabel={selectedAction.label}
            panelModel={panelModel}
            availableModels={availableModels}
            isPinned={isPinned}
            tooltipContainer={tooltipContainer}
            onModelChange={onModelChange}
            onTogglePin={onTogglePin}
            onClose={onClose}
            onDragStart={onDragStart}
          />
        </CardHeader>

        <CardContent className="sa-card-content">
          {currentAction === "custom" && panelState === "idle" && (
            <form
              className="sa-custom-row"
              onSubmit={(e) => {
                e.preventDefault()
                onRunCustom()
              }}>
              <Input
                aria-label="Custom prompt instruction"
                placeholder="Instruction"
                value={customInstruction}
                onChange={(e) => onCustomInstructionChange(e.target.value)}
              />
              <Button type="submit" variant="default" size="sm">
                Run
              </Button>
            </form>
          )}
          <PanelThinking isThinking={isThinking} thinkingText={thinkingText} />
          {body}
        </CardContent>

        <CardFooter className="sa-card-footer">
          <PanelFooter
            panelState={panelState}
            resultText={resultText}
            canReplace={canReplace}
            canInsert={canInsert}
            tooltipContainer={tooltipContainer}
            onCopy={onCopy}
            onRetry={onRetry}
            onReplace={onReplace}
            onInsertBelow={onInsertBelow}
            onOpenChat={onOpenChat}
            onCancel={onCancel}
          />
        </CardFooter>
      </Card>
    </TooltipProvider>
  )
}
