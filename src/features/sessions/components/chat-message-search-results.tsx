import { Loader2 } from "lucide-react"
import { useId } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/class-names"
import type { MessageSearchHit } from "@/lib/repositories/chat-history"

export interface MessageSearchRow {
  hit: MessageSearchHit
  sessionTitle: string
}

/** Parts keyed by where they start in the excerpt, which is unique per part. */
const snippetParts = (hit: MessageSearchHit) => {
  let offset = 0
  return hit.snippet.map((part) => {
    const entry = { ...part, offset }
    offset += part.text.length
    return entry
  })
}

/**
 * Message matches for the sidebar search: the chat each one is in and an
 * excerpt with the matched words marked. Excerpts are rendered as text parts,
 * never as markup, so a message that contains HTML shows it literally.
 */
export const ChatMessageSearchResults = ({
  rows,
  searching,
  onOpen
}: {
  rows: MessageSearchRow[]
  searching: boolean
  onOpen: (hit: MessageSearchHit) => void
}) => {
  const { t } = useTranslation()
  const excerptId = useId()
  if (rows.length === 0 && !searching) return null

  return (
    <section
      className="space-y-0.5 pb-2"
      aria-labelledby="sidebar-message-results">
      <h3
        id="sidebar-message-results"
        className="flex items-center gap-1.5 px-1.5 pb-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("sessions.search.messages_heading")}
        {searching && (
          <>
            <Loader2 className="icon-xs animate-spin" aria-hidden="true" />
            <span className="sr-only">{t("sessions.search.searching")}</span>
          </>
        )}
      </h3>
      {rows.map(({ hit, sessionTitle }) => (
        <button
          key={hit.messageId}
          type="button"
          onClick={() => onOpen(hit)}
          aria-label={t("sessions.search.open_result", {
            role:
              hit.role === "user"
                ? t("sessions.export.role_user")
                : t("sessions.export.role_assistant"),
            title: sessionTitle
          })}
          aria-describedby={`${excerptId}-${hit.messageId}`}
          className={cn(
            "flex w-full flex-col gap-0.5 rounded-control p-1.5 text-left transition-colors",
            "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
            "outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
          )}>
          <span className="truncate text-xs font-medium text-sidebar-foreground">
            {sessionTitle}
          </span>
          <span
            id={`${excerptId}-${hit.messageId}`}
            className="line-clamp-2 text-micro leading-snug">
            {snippetParts(hit).map(({ offset, text, match }) =>
              match ? (
                <mark
                  key={offset}
                  className="rounded-sm bg-app-primary-soft px-0.5 text-foreground">
                  {text}
                </mark>
              ) : (
                <span key={offset}>{text}</span>
              )
            )}
          </span>
        </button>
      ))}
    </section>
  )
}
