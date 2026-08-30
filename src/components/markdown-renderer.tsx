import { useEffect, useRef } from "react"
import { useMarkdownParser } from "@/hooks/use-markdown-parser"
import { openExternalUrl, openOptionsInTab, runtime } from "@/lib/browser-api"
import { MarkdownCodeBlockActions } from "./markdown-code-block-actions"

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
  const elements = container.querySelectorAll<HTMLElement>("[id]")
  for (const element of elements) {
    if (element.id === id) return element
  }
  return null
}

const FRAGMENT_TARGET_CLASS = "fragment-target"
const FRAGMENT_HIGHLIGHT_MS = 1800

type HighlightState = {
  element: HTMLElement
  timer: ReturnType<typeof setTimeout>
} | null

const isOptionsTarget = (resolved: URL): boolean => {
  const optionsTarget = new URL(runtime.getURL("options.html"))
  return (
    resolved.origin === optionsTarget.origin &&
    resolved.pathname === optionsTarget.pathname
  )
}

const isSameDocument = (resolved: URL, current: URL): boolean =>
  resolved.origin === current.origin &&
  resolved.pathname === current.pathname &&
  resolved.search === current.search

const handleFragmentNavigation = ({
  event,
  container,
  resolved,
  current,
  href,
  optionsTarget,
  highlight
}: {
  event: MouseEvent
  container: HTMLElement
  resolved: URL
  current: URL
  href: string
  optionsTarget: boolean
  highlight: (element: HTMLElement) => void
}): boolean => {
  const fragmentLink = resolved.hash !== "" || href.startsWith("#")
  if (!isSameDocument(resolved, current) || !fragmentLink) return false

  const fragmentTarget = findFragmentTarget(container, resolved.hash)
  if (fragmentTarget) {
    event.preventDefault()
    fragmentTarget.scrollIntoView({ block: "center" })
    highlight(fragmentTarget)
    return true
  }
  if (!optionsTarget) {
    event.preventDefault()
    return true
  }
  return false
}

const openResolvedLink = (
  event: MouseEvent,
  resolved: URL,
  optionsTarget: boolean
): void => {
  const resolvedUrl = resolved.toString()
  if (optionsTarget) {
    event.preventDefault()
    void openOptionsInTab(resolvedUrl)
    return
  }
  if (/^(https?:|chrome-extension:|moz-extension:)/i.test(resolvedUrl)) {
    event.preventDefault()
    openExternalUrl(resolvedUrl)
  }
}

export const MarkdownRenderer = ({ content }: { content: string }) => {
  const html = useMarkdownParser(content)
  const containerRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HighlightState>(null)

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
      const href = anchor?.getAttribute("href")?.trim()
      if (!href) return

      const current = new URL(globalThis.location.href)
      const resolved = new URL(href, current)
      const optionsTarget = isOptionsTarget(resolved)
      if (
        handleFragmentNavigation({
          event,
          container,
          resolved,
          current,
          href,
          optionsTarget,
          highlight
        })
      ) {
        return
      }
      openResolvedLink(event, resolved, optionsTarget)
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
