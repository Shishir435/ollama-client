import { useEffect, useRef } from "react"
import { useMarkdownParser } from "@/hooks/use-markdown-parser"
import { openExternalUrl, openOptionsInTab, runtime } from "@/lib/browser-api"
import { MarkdownCodeBlockActions } from "./markdown-code-block-actions"

/** Same-document target for a `#fragment` link, or null when absent. */
const findFragmentTarget = (
  container: HTMLElement,
  hash: string
): HTMLElement | null => {
  const raw = hash.slice(1)
  if (!raw) return null
  let id = raw
  try {
    id = decodeURIComponent(raw)
  } catch {
    // A malformed escape sequence is matched literally.
  }
  // Scoped to this message: footnote ids (fn1, fnref1) restart at 1 in every
  // assistant turn, so a document-wide lookup would jump to an older message.
  const elements = container.querySelectorAll<HTMLElement>("[id]")
  for (const element of elements) {
    if (element.id === id) return element
  }
  return null
}

const FRAGMENT_TARGET_CLASS = "fragment-target"
/** Matches the `typeset-fragment-flash` duration in `typeset.css`. */
const FRAGMENT_HIGHLIGHT_MS = 1800

export const MarkdownRenderer = ({ content }: { content: string }) => {
  const html = useMarkdownParser(content)
  const containerRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<{
    element: HTMLElement
    timer: ReturnType<typeof setTimeout>
  } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const clearHighlight = () => {
      const active = highlightRef.current
      if (!active) return
      clearTimeout(active.timer)
      active.element.classList.remove(FRAGMENT_TARGET_CLASS)
      highlightRef.current = null
    }

    const highlight = (element: HTMLElement) => {
      clearHighlight()
      // Re-clicking the same footnote must replay the animation, and a class
      // removed and re-added in one tick does not restart it on its own.
      void element.offsetWidth
      element.classList.add(FRAGMENT_TARGET_CLASS)
      highlightRef.current = {
        element,
        timer: setTimeout(clearHighlight, FRAGMENT_HIGHLIGHT_MS)
      }
    }

    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null
      if (!anchor) return

      const href = anchor.getAttribute("href")?.trim()
      if (!href) return

      const current = new URL(globalThis.location.href)
      const resolved = new URL(href, current)
      const resolvedUrl = resolved.toString()
      // Compared by pathname, not prefix: a prefix test also matches sibling
      // paths like `options.html.evil`, which would navigate a live options tab
      // to an extension path that does not exist.
      const optionsTarget = new URL(runtime.getURL("options.html"))
      const isOptionsUrl =
        resolved.origin === optionsTarget.origin &&
        resolved.pathname === optionsTarget.pathname

      /**
       * A footnote ref resolves to this very page plus a fragment, which the
       * extension-URL branch below would otherwise hand to a tab. Settings deep
       * links carry their target in the query (`options.html?tab=…`), so they
       * differ on pathname and search and never reach this branch; the target
       * lookup keeps that true even if this renderer is ever mounted inside the
       * options page, where an unmatched fragment stays a deep link.
       */
      const isSameDocument =
        resolved.origin === current.origin &&
        resolved.pathname === current.pathname &&
        resolved.search === current.search
      // A bare "#" resolves to an empty hash, so the raw href decides too.
      const isFragmentLink = resolved.hash !== "" || href.startsWith("#")
      if (isSameDocument && isFragmentLink) {
        const fragmentTarget = findFragmentTarget(container, resolved.hash)
        if (fragmentTarget) {
          event.preventDefault()
          fragmentTarget.scrollIntoView({ block: "center" })
          highlight(fragmentTarget)
          return
        }
        // A dead anchor scrolls nowhere, but it must not open this page in a tab.
        if (!isOptionsUrl) {
          event.preventDefault()
          return
        }
      }

      if (isOptionsUrl) {
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
    return () => {
      container.removeEventListener("click", handleLinkClick)
      clearHighlight()
    }
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        className="markdown-container typeset typeset-chat max-w-none px-2 py-1"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is sanitized by DOMPurify in useMarkdownParser
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <MarkdownCodeBlockActions containerRef={containerRef} html={html} />
    </>
  )
}
