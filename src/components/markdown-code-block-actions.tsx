import type { RefObject } from "react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { ArtifactPreview } from "@/features/chat/components/artifact-preview"
import { CopyButton } from "@/features/chat/components/copy-button"
import { PreviewSheet } from "@/features/chat/components/preview-sheet"
import { chatIconBtnCls } from "@/features/chat/lib/chat-styles"
import { downloadArtifact } from "@/lib/artifact-download"
import type { ChatArtifact } from "@/lib/artifacts"
import { createChatArtifactFromCodeBlock } from "@/lib/artifacts"
import { Download } from "@/lib/lucide-icon"

const codeActionButtonClass =
  "inline-flex items-center justify-center rounded border border-border/50 bg-background/90 p-1 text-muted-foreground shadow-xs backdrop-blur hover:text-foreground"

/**
 * Inline Lucide icon paths (the markdown toolbar is built with raw DOM, not
 * React, so we inject SVG markup rather than render icon components). Kept in
 * sync with the `lucide-react` icons of the same name.
 */
const ICON_PATHS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'
} as const

const iconSvg = (paths: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

/** Build an icon-only toolbar button (icons are self-explanatory; aria-label only). */
const createIconButton = (paths: string, label: string): HTMLButtonElement => {
  const button = document.createElement("button")
  button.type = "button"
  button.className = codeActionButtonClass
  button.innerHTML = iconSvg(paths)
  button.setAttribute("aria-label", label)
  return button
}

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

    let artifactIndex = 0
    const blocks = Array.from(container.querySelectorAll("pre"))
    blocks.forEach((pre) => {
      if (pre.parentElement?.dataset.codeBlockShell === "true") return

      const code = pre.querySelector("code")
      const rawCode = code?.textContent ?? ""
      const language = pre.dataset.codeLanguage ?? ""
      const artifact = createChatArtifactFromCodeBlock({
        code: rawCode,
        language,
        index: artifactIndex + 1
      })
      if (artifact) artifactIndex += 1

      const shell = document.createElement("div")
      shell.dataset.codeBlockShell = "true"
      shell.className = "group/code relative"

      const toolbar = document.createElement("div")
      toolbar.className =
        "not-prose absolute right-1 top-1 z-10 flex items-center gap-1 opacity-80 transition-opacity group-hover/code:opacity-100"

      const copyLabel = t("chat.actions.copy")
      const copyButton = createIconButton(ICON_PATHS.copy, copyLabel)
      copyButton.addEventListener("click", () => {
        void navigator.clipboard.writeText(rawCode)
        copyButton.innerHTML = iconSvg(ICON_PATHS.check)
        window.setTimeout(() => {
          copyButton.innerHTML = iconSvg(ICON_PATHS.copy)
        }, 1500)
      })
      toolbar.appendChild(copyButton)

      if (artifact?.renderable) {
        const previewButton = createIconButton(
          ICON_PATHS.eye,
          `${t("chat.actions.preview")} ${artifact.title}`
        )
        previewButton.addEventListener("click", () => {
          setActiveArtifact(artifact)
        })
        toolbar.appendChild(previewButton)
      }

      if (artifact) {
        const downloadButton = createIconButton(
          ICON_PATHS.download,
          `${t("chat.actions.download")} ${artifact.title}`
        )
        downloadButton.addEventListener("click", () => {
          void downloadArtifact(artifact)
        })
        toolbar.appendChild(downloadButton)
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
  )
}
