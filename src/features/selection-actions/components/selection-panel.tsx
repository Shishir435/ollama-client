import type { PointerEvent as ReactPointerEvent } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { ProviderModel } from "@/types"
import type { SelectionActionId } from "../types"
import { PanelFooter } from "./panel-footer"
import { PanelHeader } from "./panel-header"
import { PanelThinking } from "./panel-thinking"
import type { SelectionPanelState } from "./selection-actions-overlay"

interface SelectionPanelProps {
  panelState: SelectionPanelState
  currentAction: SelectionActionId
  enabledActionIds: SelectionActionId[]
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
  onActionChange: (actionId: SelectionActionId) => void
  onModelChange: (model: string, providerId?: string) => void
  onRunAction: (actionId: SelectionActionId) => void
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

export function SelectionPanel({
  panelState,
  currentAction,
  enabledActionIds,
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
  onActionChange,
  onModelChange,
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
}: SelectionPanelProps) {
  const { t } = useTranslation()
  const body =
    panelState === "error" ? (
      <div className="sa-result sa-error">{errorText}</div>
    ) : (
      <div className="sa-result">
        {resultText || (
          <span className="sa-muted">
            {isThinking
              ? t("selection_button.panel.thinking")
              : t("selection_button.panel.working")}
          </span>
        )}
      </div>
    )

  return (
    <TooltipProvider>
      <Card
        className="sa-panel-card"
        role="dialog"
        aria-label={t("selection_button.panel.working")}>
        <CardHeader className="sa-card-header">
          <PanelHeader
            currentAction={currentAction}
            enabledActionIds={enabledActionIds}
            panelModel={panelModel}
            availableModels={availableModels}
            isPinned={isPinned}
            tooltipContainer={tooltipContainer}
            onActionChange={onActionChange}
            onModelChange={onModelChange}
            onTogglePin={onTogglePin}
            onBack={onBack}
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
                placeholder={t("selection_button.panel.instruction_ph")}
                value={customInstruction}
                onChange={(e) => onCustomInstructionChange(e.target.value)}
              />
              <Button type="submit" variant="default" size="sm">
                {t("selection_button.panel.run")}
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
