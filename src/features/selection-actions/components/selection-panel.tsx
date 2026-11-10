import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useSelectionOverlay } from "../selection-overlay-context"
import { PanelChangePreview } from "./panel-change-preview"
import { PanelFooter } from "./panel-footer"
import { PanelHeader } from "./panel-header"
import { PanelMarkdown } from "./panel-markdown"
import { PanelRefinement } from "./panel-refinement"
import { PanelThinking } from "./panel-thinking"

/** Present a non-modal result with refinement, exact replacement preview and recovery feedback. */
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
    canReplace,
    actions
  } = useSelectionOverlay()

  const cardRef = useRef<HTMLDialogElement>(null)
  /** Focus is placed once on open; later action switches keep the user's own. */
  const openedAction = useRef(currentAction)

  /**
   * The panel opens from a toolbar press, keyboard or pointer; put focus on
   * its first control so keyboard users land inside it. Restoring focus on
   * close is the content script's job, because closing unmounts this tree.
   */
  useEffect(() => {
    const card = cardRef.current
    const target =
      openedAction.current === "custom"
        ? card?.querySelector<HTMLElement>("input:not([disabled])")
        : null
    ;(
      target ??
      card?.querySelector<HTMLElement>(
        "button:not([disabled]), select:not([disabled]), input:not([disabled])"
      )
    )?.focus({ preventScroll: true })
  }, [])

  const actionLabel = t(`selection_button.actions.${currentAction}.label`)
  const isStreaming = panelState === "streaming"
  const body = (() => {
    if (panelState === "error") {
      return (
        <>
          <div className="sa-notice sa-error" role="alert">
            {errorKey ? t(errorKey) : errorText}
          </div>
          {resultText && (
            <div className="sa-result sa-result--md">
              <PanelMarkdown content={resultText} />
            </div>
          )}
        </>
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
      <dialog
        open
        ref={cardRef}
        className="sa-panel-card"
        aria-modal="false"
        aria-label={actionLabel}>
        <header className="sa-card-header">
          <PanelHeader />
        </header>

        <div className="sa-card-content">
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
          {canReplace && <PanelChangePreview />}
          {panelState === "done" && resultText.trim() && <PanelRefinement />}
          {(notice === "copy_failed" ||
            notice === "open_chat_failed" ||
            notice === "apply_failed" ||
            notice === "apply_stale" ||
            notice === "undo_failed") && (
            <p className="sa-notice sa-error" role="alert">
              {t(`selection_button.panel.${notice}`)}
            </p>
          )}
          {(notice === "applied" || notice === "undone") && (
            <output className="sa-notice">
              {t(`selection_button.panel.${notice}`)}
            </output>
          )}
        </div>

        <footer className="sa-card-footer">
          <PanelFooter />
        </footer>
      </dialog>
    </TooltipProvider>
  )
}
