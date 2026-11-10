import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useSelectionOverlay } from "../selection-overlay-context"
import { compareSelectionText } from "../text-diff"
import type { TextChange } from "../text-diff"

/** Plain text mirrors exactly what Replace writes, including literal markup. */
export function PanelChangePreview() {
  const { t } = useTranslation()
  const { originalText = "", resultText } = useSelectionOverlay()
  const changes = useMemo(() => {
    let offset = 0
    const keyed: (TextChange & { key: string })[] = []
    for (const change of compareSelectionText(
      originalText,
      resultText.trim()
    )) {
      const key = `${change.kind}:${offset}`
      offset += change.text.length
      keyed.push({ ...change, key })
    }
    return keyed
  }, [originalText, resultText])
  return (
    <details className="sa-preview">
      <summary>{t("selection_button.panel.preview_changes")}</summary>
      <div className="sa-preview-content">
        <div className="sa-preview-label">
          {t("selection_button.panel.original_text")}
        </div>
        <div className="sa-preview-text">
          {changes.map((change) =>
            change.kind === "added" ? null : change.kind === "removed" ? (
              <del key={change.key}>{change.text}</del>
            ) : (
              <span key={change.key}>{change.text}</span>
            )
          )}
        </div>
        <div className="sa-preview-label">
          {t("selection_button.panel.proposed_text")}
        </div>
        <div className="sa-preview-text">
          {changes.map((change) =>
            change.kind === "removed" ? null : change.kind === "added" ? (
              <ins key={change.key}>{change.text}</ins>
            ) : (
              <span key={change.key}>{change.text}</span>
            )
          )}
        </div>
      </div>
    </details>
  )
}
