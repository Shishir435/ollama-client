import { useEffect, useMemo, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ChatArtifact } from "@/lib/artifacts"
import { TriangleAlert } from "@/lib/lucide-icon"
import { PreviewTextBlock } from "./preview-sheet"

const PREVIEW_RESET_STYLE =
  "<style>html,body{margin:0!important;padding:0!important;min-height:100%;}</style>"
const PREVIEW_NAVIGATION_GUARD = `<script>(()=>{const scrollToHash=(hash)=>{try{const id=decodeURIComponent(hash.slice(1));const target=document.getElementById(id)||document.getElementsByName(id)[0];if(target)target.scrollIntoView({block:"start"});}catch{}};document.addEventListener("click",(event)=>{const target=event.target instanceof Element?event.target:null;const link=target?.closest("a[href]");if(!link)return;const href=link.getAttribute("href")||"";event.preventDefault();event.stopPropagation();if(href.startsWith("#")&&href.length>1)scrollToHash(href);},true);document.addEventListener("submit",(event)=>{event.preventDefault();event.stopPropagation();},true);window.open=()=>null;})();</script>`
const PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'"
].join("; ")
const PREVIEW_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`

let mermaidInitialized = false

const hashContent = (content: string): string => {
  let hash = 5381
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash) ^ content.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

const withPreviewChrome = (html: string): string => {
  let next = html
  if (/<\/head>/i.test(html)) {
    next = next.replace(
      /<\/head>/i,
      `${PREVIEW_CSP_META}${PREVIEW_RESET_STYLE}</head>`
    )
  } else {
    next = `${PREVIEW_CSP_META}${PREVIEW_RESET_STYLE}${next}`
  }
  if (/<\/body>/i.test(next)) {
    return next.replace(/<\/body>/i, `${PREVIEW_NAVIGATION_GUARD}</body>`)
  }
  return `${next}${PREVIEW_NAVIGATION_GUARD}`
}

const previewSrcDoc = (artifact: ChatArtifact): string => {
  if (artifact.kind === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8">${PREVIEW_CSP_META}<style>html,body{margin:0;min-height:100%;background:#fff;color:#111;display:grid;place-items:center}svg{max-width:100%;max-height:100vh}</style></head><body>${artifact.content}</body></html>`
  }

  if (/^\s*<!doctype html\b|^\s*<html[\s>]/i.test(artifact.content)) {
    return withPreviewChrome(artifact.content)
  }

  return `<!doctype html><html><head><meta charset="utf-8">${PREVIEW_CSP_META}${PREVIEW_RESET_STYLE}</head><body>${artifact.content}${PREVIEW_NAVIGATION_GUARD}</body></html>`
}

const svgPreviewSrcDoc = (svg: string): string => {
  const csp =
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'"
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;min-height:100%;background:#fff;color:#0f172a;display:grid;place-items:center}svg{max-width:100%;height:auto}</style></head><body>${svg}</body></html>`
}

const MermaidPreview = ({ artifact }: { artifact: ChatArtifact }) => {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const renderId = useMemo(
    () => `artifact-${artifact.id}-${hashContent(artifact.content)}`,
    [artifact]
  )

  useEffect(() => {
    let cancelled = false

    const render = async () => {
      setSvg(null)
      setError(null)

      try {
        const { default: mermaid } = await import("mermaid")
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            themeVariables: {
              background: "#ffffff",
              primaryColor: "#e0f2fe",
              primaryTextColor: "#0f172a",
              primaryBorderColor: "#0284c7",
              lineColor: "#475569",
              textColor: "#0f172a"
            }
          })
          mermaidInitialized = true
        }

        const result = await mermaid.render(renderId, artifact.content)
        if (!cancelled) setSvg(result.svg)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    void render()

    return () => {
      cancelled = true
    }
  }, [artifact, renderId])

  if (error) {
    return (
      <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
        <div className="space-y-3 p-4">
          <div className="flex items-start gap-2 rounded-control border border-status-warning/40 bg-status-warning/10 p-3">
            <TriangleAlert className="icon-sm mt-0.5 shrink-0 text-status-warning" />
            <div className="min-w-0 text-xs">
              <p className="font-medium text-status-warning">
                Couldn't render this diagram
              </p>
              <p className="mt-0.5 text-muted-foreground">
                The Mermaid syntax is invalid — the raw source is shown below.
              </p>
            </div>
          </div>
          <PreviewTextBlock
            text={artifact.content}
            emptyText="No Mermaid content"
            className="rounded-control bg-muted/40 font-mono text-2xs"
          />
          <details className="px-1 text-2xs text-muted-foreground">
            <summary className="cursor-pointer select-none">
              Error details
            </summary>
            <pre className="mt-1 whitespace-pre-wrap wrap-anywhere">
              {error}
            </pre>
          </details>
        </div>
      </ScrollArea>
    )
  }

  if (!svg) {
    return (
      <div className="grid min-h-96 flex-1 place-items-center text-sm text-muted-foreground">
        Rendering Mermaid diagram...
      </div>
    )
  }

  return (
    <iframe
      title={`${artifact.title} preview`}
      sandbox=""
      srcDoc={svgPreviewSrcDoc(svg)}
      className="h-full min-h-96 w-full flex-1 border-0 bg-white"
      data-testid="mermaid-preview"
    />
  )
}

export const ArtifactPreview = ({ artifact }: { artifact: ChatArtifact }) => {
  if (artifact.kind === "mermaid") {
    return <MermaidPreview artifact={artifact} />
  }

  if (artifact.renderable) {
    return (
      <iframe
        title={artifact.title}
        sandbox="allow-scripts"
        srcDoc={previewSrcDoc(artifact)}
        className="h-full min-h-96 w-full flex-1 border-0 bg-white"
      />
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1 overflow-x-hidden">
      <PreviewTextBlock
        text={artifact.content}
        emptyText="No artifact content"
        className="font-mono text-2xs"
      />
    </ScrollArea>
  )
}

export { previewSrcDoc }
