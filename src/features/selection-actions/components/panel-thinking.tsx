import { useEffect, useState } from "react"

interface PanelThinkingProps {
  isThinking: boolean
  thinkingText: string
}

export function PanelThinking({
  isThinking,
  thinkingText
}: PanelThinkingProps) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (isThinking) {
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
        onClick={() => setExpanded((v) => !v)}>
        {isThinking ? (
          <span className="sa-thinking-pulse" aria-hidden="true" />
        ) : (
          <span className="sa-thinking-chevron">{expanded ? "▾" : "▸"}</span>
        )}
        <span className="sa-thinking-label">
          {isThinking ? "Reasoning…" : "Reasoning"}
        </span>
        {!isThinking && (
          <span className="sa-thinking-chevron sa-thinking-chevron-end">
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </button>
      {expanded && <div className="sa-thinking-body">{thinkingText}</div>}
    </div>
  )
}
