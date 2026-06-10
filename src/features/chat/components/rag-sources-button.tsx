import { Info } from "lucide-react"
import { useTranslation } from "react-i18next"
import { MessageSourcesSheet, type SourceItem } from "./message-sources-sheet"

export interface RAGSourcesButtonProps {
  sources: SourceItem[]
  query?: string
  sessionId?: string
  enableFeedback?: boolean
}

export function RAGSourcesButton({
  sources,
  query,
  sessionId,
  enableFeedback = true
}: RAGSourcesButtonProps) {
  const { t } = useTranslation()
  if (!sources || sources.length === 0) return null

  const items: SourceItem[] = sources
  const n = sources.length

  return (
    <MessageSourcesSheet
      icon={<Info className="icon-xs" />}
      badgeCount={n}
      tooltip={t("chat.sources.rag_source", { count: n })}
      ariaLabel={t("chat.sources.view_retrieved", { count: n })}
      title={t("chat.sources.retrieved_title", { count: n })}
      sections={[{ items }]}
      renderMetadata={(item) => {
        const relevance = Math.max(
          0,
          Math.min(100, Math.round(item.score * 100))
        )
        return (
          <>
            score: {item.score.toFixed(2)} | {relevance}%
            {item.chunkIndex !== undefined ? ` | #${item.chunkIndex + 1}` : ""}
            {item.source ? ` | ${item.source}` : ""}
          </>
        )
      }}
      feedback={enableFeedback ? { query, sessionId } : undefined}
    />
  )
}
