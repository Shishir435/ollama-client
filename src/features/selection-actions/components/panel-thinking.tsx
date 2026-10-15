import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { PanelMarkdown } from "./panel-markdown"

interface PanelThinkingProps {
  isThinking: boolean
  thinkingText: string
}

export function PanelThinking({
  isThinking,
  thinkingText
}: PanelThinkingProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (isThinking) {
      // oxlint-disable-next-line react/set-state-in-effect -- Streaming state drives automatic expansion while users can still toggle the details.
      setExpanded(true)
    } else if (thinkingText) {
      setExpanded(false)
    }
  }, [isThinking, thinkingText])

  if (!thinkingText) return null

  return (
    <div className="sa-thinking-section">
      <button
        type="button"
        className="sa-thinking-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}>
        {isThinking && (
          <span className="sa-thinking-pulse" aria-hidden="true" />
        )}
        <span className="sa-thinking-label">
          {isThinking
            ? t("selection_button.panel.reasoning_active")
            : t("selection_button.panel.reasoning_done")}
        </span>
        {!isThinking && (
          <ChevronRight
            aria-hidden="true"
            className="sa-thinking-chevron icon-xs"
            data-expanded={expanded}
          />
        )}
      </button>
      {expanded && (
        <div className="sa-thinking-body">
          <PanelMarkdown content={thinkingText} />
        </div>
      )}
    </div>
  )
}
