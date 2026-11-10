import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSelectionOverlay } from "../selection-overlay-context"

/** One follow-up at a time; the source selection remains unchanged. */
export function PanelRefinement() {
  const { t } = useTranslation()
  const { actions } = useSelectionOverlay()
  const [instruction, setInstruction] = useState("")
  return (
    <form
      className="sa-refine-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (!instruction.trim()) return
        actions.refine(instruction.trim())
      }}>
      <Input
        aria-label={t("selection_button.panel.refine_label")}
        placeholder={t("selection_button.panel.refine_placeholder")}
        value={instruction}
        maxLength={2000}
        onChange={(event) => setInstruction(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!instruction.trim()}>
        {t("selection_button.panel.refine")}
      </Button>
    </form>
  )
}
