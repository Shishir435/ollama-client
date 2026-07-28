import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useSelectionOverlay } from "../selection-overlay-context"
import { PanelFooter } from "./panel-footer"
import { PanelHeader } from "./panel-header"
import { PanelMarkdown } from "./panel-markdown"
import { PanelThinking } from "./panel-thinking"

export function SelectionPanel() {
  const { t } = useTranslation()
  const {
    panelState,
    currentAction,
    isThinking,
    thinkingText,
    resultText,
    errorText,
    customInstruction,
    actions
  } = useSelectionOverlay()

  const actionLabel = t(
    `selection_button.actions.${currentAction}.label`,
    currentAction
  )
  const body = (() => {
    if (panelState === "error") {
      return <div className="sa-result sa-error">{errorText}</div>
    }

    if (resultText) {
      return (
        <div className="sa-result sa-result--md">
          <PanelMarkdown content={resultText} />
        </div>
      )
    }

    if (panelState === "streaming") {
      return (
        <div className="sa-result">
          <span className="sa-muted">
            {isThinking
              ? t("selection_button.panel.thinking")
              : t("selection_button.panel.working")}
          </span>
        </div>
      )
    }

    return null
  })()

  return (
    <TooltipProvider>
      <Card className="sa-panel-card" role="dialog" aria-label={actionLabel}>
        <CardHeader className="sa-card-header">
          <PanelHeader />
        </CardHeader>

        <CardContent className="sa-card-content">
          {currentAction === "custom" && panelState === "open" && (
            <form
              className="sa-custom-row"
              onSubmit={(e) => {
                e.preventDefault()
                if (!customInstruction.trim()) return
                actions.runCustom()
              }}>
              <Input
                required
                aria-label="Custom prompt instruction"
                placeholder={t("selection_button.panel.instruction_ph")}
                value={customInstruction}
                onChange={(e) => actions.setCustomInstruction(e.target.value)}
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
          <PanelFooter />
        </CardFooter>
      </Card>
    </TooltipProvider>
  )
}
