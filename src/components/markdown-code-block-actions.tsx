import { Check, Copy, Download, Eye } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { ArtifactPreview } from "@/features/chat/components/artifact-preview"
import { CopyButton } from "@/features/chat/components/copy-button"
import { PreviewSheet } from "@/features/chat/components/preview-sheet"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { downloadArtifact } from "@/lib/artifact-download"
import type { ChatArtifact } from "@/lib/artifacts"
import { createChatArtifactFromCodeBlock } from "@/lib/artifacts"
import { sanitizedHtmlToReactNodes } from "@/lib/sanitized-html-to-react"

const codeActionButtonClass =
  "inline-flex items-center justify-center rounded border border-border bg-surface-overlay p-1 text-muted-foreground shadow-xs backdrop-blur hover:text-foreground"

interface MarkdownCodeBlockProps {
  code: string
  artifact: ChatArtifact | null
  children: ReactNode
  onPreview: (artifact: ChatArtifact) => void
  labels: {
    copy: string
    copied: string
    preview: string
    download: string
  }
}

interface MarkdownCodeBlockLabels {
  copy: string
  copied: string
  preview: string
  download: string
}

const MarkdownCodeBlock = ({
  code,
  artifact,
  children,
  onPreview,
  labels
}: MarkdownCodeBlockProps) => {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), [])

  return (
    <div data-code-block-shell="true" className="group/code relative">
      <div className="not-typeset absolute right-1 top-1 z-10 flex items-center gap-1 opacity-80 transition-opacity group-hover/code:opacity-100">
        <button
          type="button"
          className={codeActionButtonClass}
          aria-label={copied ? labels.copied : labels.copy}
          onClick={() => {
            void navigator.clipboard.writeText(code)
            setCopied(true)
            window.clearTimeout(copyTimerRef.current)
            copyTimerRef.current = window.setTimeout(
              () => setCopied(false),
              1500
            )
          }}>
          {copied ? (
            <Check className="icon-xs" />
          ) : (
            <Copy className="icon-xs" />
          )}
        </button>
        {artifact?.renderable && (
          <button
            type="button"
            className={codeActionButtonClass}
            aria-label={`${labels.preview} ${artifact.title}`}
            onClick={() => onPreview(artifact)}>
            <Eye className="icon-xs" />
          </button>
        )}
        {artifact && (
          <button
            type="button"
            className={codeActionButtonClass}
            aria-label={`${labels.download} ${artifact.title}`}
            onClick={() => void downloadArtifact(artifact)}>
            <Download className="icon-xs" />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

const buildMarkdownNodes = (
  html: string,
  labels: MarkdownCodeBlockLabels,
  onPreview: (artifact: ChatArtifact) => void
): ReactNode[] => {
  let artifactIndex = 0
  return sanitizedHtmlToReactNodes(html, ({ key, code, language, pre }) => {
    const artifact = createChatArtifactFromCodeBlock({
      code,
      language,
      index: artifactIndex + 1
    })
    if (artifact) artifactIndex += 1

    return (
      <MarkdownCodeBlock
        key={key}
        code={code}
        artifact={artifact}
        onPreview={onPreview}
        labels={labels}>
        {pre}
      </MarkdownCodeBlock>
    )
  })
}

export const MarkdownCodeBlockActions = ({ html }: { html: string }) => {
  const { t } = useTranslation()
  const [activeArtifact, setActiveArtifact] = useState<ChatArtifact | null>(
    null
  )
  const labels = useMemo(
    () => ({
      copy: t("chat.actions.copy"),
      copied: t("chat.actions.copied"),
      preview: t("chat.actions.preview"),
      download: t("chat.actions.download")
    }),
    [t]
  )

  const markdownNodes = useMemo(() => {
    return buildMarkdownNodes(html, labels, setActiveArtifact)
  }, [html, labels])

  return (
    <>
      {markdownNodes}
      <PreviewSheet
        open={Boolean(activeArtifact)}
        onOpenChange={(next) => {
          if (!next) setActiveArtifact(null)
        }}
        title={activeArtifact?.title ?? "Preview"}
        meta={
          activeArtifact
            ? `${activeArtifact.language.toUpperCase()} · ${activeArtifact.content.length.toLocaleString()} chars`
            : undefined
        }
        actions={
          activeArtifact ? (
            <div className="flex items-center gap-1">
              <CopyButton text={activeArtifact.content} />
              <TooltipActionButton
                ariaLabel={t("chat.actions.download")}
                tooltip={t("chat.actions.download")}
                size="icon"
                variant="ghost"
                className={chatIconBtnCls}
                icon={<Download className="icon-xs" />}
                onClick={() => {
                  void downloadArtifact(activeArtifact)
                }}
              />
            </div>
          ) : null
        }
        className="w-[min(56rem,calc(100vw-1rem))] sm:max-w-4xl">
        {activeArtifact ? <ArtifactPreview artifact={activeArtifact} /> : null}
      </PreviewSheet>
    </>
  )
}
