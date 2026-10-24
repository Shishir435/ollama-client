import { useState } from "react"
import { useTranslation } from "react-i18next"
import { remoteMarkdownImageUrl } from "@/lib/chat-markdown-sanitizer"

/** Consent belongs to this exact URL, so streamed updates cannot inherit it. */
export const MarkdownImage = ({
  attributes
}: {
  attributes: Record<string, unknown>
}) => {
  const { t } = useTranslation()
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const remote = remoteMarkdownImageUrl(
    String(attributes["data-remote-image-src"] ?? "")
  )
  const alt = String(attributes.alt ?? "")
  if (remote && loadedUrl !== remote) {
    return (
      <span className="inline-flex items-center gap-2 rounded border border-border px-2 py-1 text-sm text-muted-foreground">
        {alt || t("chat.remote_image.blocked")}
        <span className="font-mono text-xs" title={remote}>
          {new URL(remote).hostname}
        </span>
        <button
          type="button"
          className="underline"
          title={remote}
          onClick={() => setLoadedUrl(remote)}>
          {t("chat.remote_image.load")}
        </button>
      </span>
    )
  }
  const { "data-remote-image-src": _remote, ...imageAttributes } = attributes
  return (
    <img
      {...imageAttributes}
      src={remote ?? (attributes.src as string | undefined)}
      alt={alt}
      referrerPolicy="no-referrer"
    />
  )
}
