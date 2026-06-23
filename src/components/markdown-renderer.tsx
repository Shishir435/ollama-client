import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArtifactPreview } from "@/features/chat/components/artifact-canvas"
import { CopyButton } from "@/features/chat/components/copy-button"
import { PreviewSheet } from "@/features/chat/components/preview-sheet"
import { useMarkdownParser } from "@/hooks/use-markdown-parser"
import type { ChatArtifact } from "@/lib/artifacts"
import { createChatArtifactFromCodeBlock } from "@/lib/artifacts"
import { openExternalUrl, openOptionsInTab, runtime } from "@/lib/browser-api"

export const MarkdownRenderer = ({ content }: { content: string }) => {
  const { t } = useTranslation()
  const html = useMarkdownParser(content)
  const containerRef = useRef<HTMLDivElement>(null)
  const [activeArtifact, setActiveArtifact] = useState<ChatArtifact | null>(
    null
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || !html) return

    const blocks = Array.from(container.querySelectorAll("pre"))
    blocks.forEach((pre, index) => {
      if (pre.parentElement?.dataset.codeBlockShell === "true") return

      const code = pre.querySelector("code")
      const rawCode = code?.textContent ?? ""
      const language = pre.dataset.codeLanguage ?? ""
      const artifact = createChatArtifactFromCodeBlock({
        code: rawCode,
        language,
        index: index + 1
      })

      const shell = document.createElement("div")
      shell.dataset.codeBlockShell = "true"
      shell.className = "group/code relative"

      const toolbar = document.createElement("div")
      toolbar.className =
        "not-prose absolute right-1 top-1 z-10 flex items-center gap-1 opacity-80 transition-opacity group-hover/code:opacity-100"

      const copyButton = document.createElement("button")
      copyButton.type = "button"
      copyButton.className =
        "rounded border border-border/50 bg-background/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-xs backdrop-blur hover:text-foreground"
      copyButton.textContent = t("chat.actions.copy")
      copyButton.setAttribute("aria-label", t("chat.actions.copy"))
      copyButton.addEventListener("click", () => {
        void navigator.clipboard.writeText(rawCode)
        copyButton.textContent = t("chat.actions.copied")
        window.setTimeout(() => {
          copyButton.textContent = t("chat.actions.copy")
        }, 1500)
      })
      toolbar.appendChild(copyButton)

      if (artifact?.renderable) {
        const previewButton = document.createElement("button")
        previewButton.type = "button"
        previewButton.className =
          "rounded border border-border/50 bg-background/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-xs backdrop-blur hover:text-foreground"
        previewButton.textContent = "Preview"
        previewButton.setAttribute("aria-label", `Preview ${artifact.title}`)
        previewButton.addEventListener("click", () => {
          setActiveArtifact(artifact)
        })
        toolbar.appendChild(previewButton)
      }

      pre.replaceWith(shell)
      shell.appendChild(toolbar)
      shell.appendChild(pre)
    })
  }, [html, t])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null
      if (!anchor) return

      const href = anchor.getAttribute("href")?.trim()
      if (!href) return

      const resolvedUrl = new URL(href, globalThis.location.href).toString()
      const optionsUrl = runtime.getURL("options.html")

      if (resolvedUrl.startsWith(optionsUrl)) {
        event.preventDefault()
        void openOptionsInTab(resolvedUrl)
        return
      }

      if (/^(https?:|chrome-extension:|moz-extension:)/i.test(resolvedUrl)) {
        event.preventDefault()
        openExternalUrl(resolvedUrl)
      }
    }

    container.addEventListener("click", handleLinkClick)
    return () => container.removeEventListener("click", handleLinkClick)
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        className="markdown-container prose prose-sm max-w-none wrap-break-word px-2 py-1 dark:prose-invert [&_code]:wrap-break-word [&_code]:whitespace-pre-wrap [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs [&_pre_code]:text-foreground [&_table]:block [&_table]:overflow-x-auto"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized by DOMPurify in useMarkdownParser
        dangerouslySetInnerHTML={{ __html: html }}
      />
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
          activeArtifact ? <CopyButton text={activeArtifact.content} /> : null
        }
        className="w-[min(56rem,calc(100vw-1rem))] sm:max-w-4xl">
        {activeArtifact ? <ArtifactPreview artifact={activeArtifact} /> : null}
      </PreviewSheet>
    </>
  )
}
