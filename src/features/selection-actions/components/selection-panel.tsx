import { useEffect, useRef } from "react"
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
    errorKey,
    notice,
    customInstruction,
    actions
  } = useSelectionOverlay()

  const cardRef = useRef<HTMLDivElement>(null)

  /**
   * The panel opens from a toolbar press, keyboard or pointer; put focus on
   * its first control so keyboard users land inside it. Restoring focus on
   * close is the content script's job, because closing unmounts this tree.
   */
  useEffect(() => {
    cardRef.current
      ?.querySelector<HTMLElement>(
        "button:not([disabled]), select:not([disabled]), input:not([disabled])"
      )
      ?.focus({ preventScroll: true })
  }, [])

  const actionLabel = t(`selection_button.actions.${currentAction}.label`)
  const isStreaming = panelState === "streaming"
  const body = (() => {
    if (panelState === "error") {
      return (
        <div className="sa-result sa-error" role="alert">
          {errorKey ? t(errorKey) : errorText}
        </div>
      )
    }

    if (resultText) {
      return (
        <div
          className="sa-result sa-result--md"
          aria-live="polite"
          aria-busy={isStreaming}>
          <PanelMarkdown content={resultText} />
        </div>
      )
    }

    if (isStreaming) {
      return (
        <div className="sa-result" aria-live="polite" aria-busy="true">
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
      <Card
        ref={cardRef}
        className="sa-panel-card"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The content controller manages this nonmodal overlay; native dialog lifecycle would change selection behavior.
        role="dialog"
        aria-modal="false"
        aria-label={actionLabel}>
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
                aria-label={t(
                  "selection_button.panel.custom_instruction_label"
                )}
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
          {(notice === "copy_failed" || notice === "apply_failed") && (
            <p className="sa-notice sa-error" role="alert">
              {t(`selection_button.panel.${notice}`)}
            </p>
          )}
        </CardContent>

        <CardFooter className="sa-card-footer">
          <PanelFooter />
        </CardFooter>
      </Card>
    </TooltipProvider>
  )
}
