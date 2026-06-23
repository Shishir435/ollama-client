import type { RefObject } from "react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { ArtifactPreview } from "@/features/chat/components/artifact-preview"
import { CopyButton } from "@/features/chat/components/copy-button"
import { PreviewSheet } from "@/features/chat/components/preview-sheet"
import type { ChatArtifact } from "@/lib/artifacts"
import { createChatArtifactFromCodeBlock } from "@/lib/artifacts"

const codeActionButtonClass =
  "rounded border border-border/50 bg-background/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-xs backdrop-blur hover:text-foreground"

export const MarkdownCodeBlockActions = ({
  containerRef,
  html
}: {
  containerRef: RefObject<HTMLDivElement | null>
  html: string
}) => {
  const { t } = useTranslation()
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
      copyButton.className = codeActionButtonClass
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
        previewButton.className = codeActionButtonClass
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
  }, [containerRef, html, t])

  return (
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
  )
}
