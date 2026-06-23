import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ChatArtifact } from "@/lib/artifacts"
import { extractChatArtifacts } from "@/lib/artifacts"
import { Code, Eye, Sparkles } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import { CopyButton } from "./copy-button"
import { PreviewSheet, PreviewTextBlock } from "./preview-sheet"

const PREVIEW_RESET_STYLE =
  "<style>html,body{margin:0!important;padding:0!important;min-height:100%;}</style>"
const PREVIEW_NAVIGATION_GUARD = `<script>(()=>{const scrollToHash=(hash)=>{try{const id=decodeURIComponent(hash.slice(1));const target=document.getElementById(id)||document.getElementsByName(id)[0];if(target)target.scrollIntoView({block:"start"});}catch{}};document.addEventListener("click",(event)=>{const target=event.target instanceof Element?event.target:null;const link=target?.closest("a[href]");if(!link)return;const href=link.getAttribute("href")||"";event.preventDefault();event.stopPropagation();if(href.startsWith("#")&&href.length>1)scrollToHash(href);},true);document.addEventListener("submit",(event)=>{event.preventDefault();event.stopPropagation();},true);window.open=()=>null;})();</script>`

const withPreviewChrome = (html: string): string => {
  let next = html
  if (/<\/head>/i.test(html)) {
    next = next.replace(/<\/head>/i, `${PREVIEW_RESET_STYLE}</head>`)
  } else {
    next = `${PREVIEW_RESET_STYLE}${next}`
  }
  if (/<\/body>/i.test(next)) {
    return next.replace(/<\/body>/i, `${PREVIEW_NAVIGATION_GUARD}</body>`)
  }
  return `${next}${PREVIEW_NAVIGATION_GUARD}`
}

const previewSrcDoc = (artifact: ChatArtifact): string => {
  const csp = [
    "default-src 'none'",
    "img-src data: blob:",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'"
  ].join("; ")

  if (artifact.kind === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;min-height:100%;background:#fff;color:#111;display:grid;place-items:center}svg{max-width:100%;max-height:100vh}</style></head><body>${artifact.content}</body></html>`
  }

  if (/^\s*<!doctype html\b|^\s*<html[\s>]/i.test(artifact.content)) {
    return withPreviewChrome(artifact.content)
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${PREVIEW_RESET_STYLE}</head><body>${artifact.content}${PREVIEW_NAVIGATION_GUARD}</body></html>`
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
    () => `artifact-${artifact.id}-${artifact.content.length}`,
    [artifact]
  )

  useEffect(() => {
    let cancelled = false

    const render = async () => {
      setSvg(null)
      setError(null)

      try {
        const { default: mermaid } = await import("mermaid")
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
        <PreviewTextBlock
          text={`Mermaid render failed:\n\n${error}\n\nSource:\n${artifact.content}`}
          emptyText="No Mermaid content"
          className="font-mono text-[11px]"
        />
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
        className="font-mono text-[11px]"
      />
    </ScrollArea>
  )
}

export const ArtifactCanvas = ({
  content,
  enabled,
  className
}: {
  content: string
  enabled: boolean
  className?: string
}) => {
  const artifacts = useMemo(() => extractChatArtifacts(content), [content])
  const [activeId, setActiveId] = useState<string | null>(null)

  if (!enabled || artifacts.length === 0) return null

  const active = artifacts.find((artifact) => artifact.id === activeId) ?? null

  return (
    <div className={cn("not-prose mt-2 flex flex-wrap gap-1.5", className)}>
      {artifacts.map((artifact) => (
        <Button
          key={artifact.id}
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 gap-1.5 rounded-chip px-2 text-xs"
          onClick={() => setActiveId(artifact.id)}>
          {artifact.renderable ? (
            <Eye className="icon-xs" />
          ) : (
            <Code className="icon-xs" />
          )}
          <span className="max-w-44 truncate">
            {artifact.renderable ? "Preview" : "Open"} {artifact.title}
          </span>
        </Button>
      ))}
      <PreviewSheet
        open={Boolean(active)}
        onOpenChange={(next) => {
          if (!next) setActiveId(null)
        }}
        title={active?.title ?? "Artifact"}
        meta={
          active
            ? `${active.language.toUpperCase()} · ${active.content.length.toLocaleString()} chars`
            : undefined
        }
        actions={active ? <CopyButton text={active.content} /> : undefined}
        className="w-[min(56rem,calc(100vw-1rem))] sm:max-w-4xl">
        {active ? (
          <ArtifactPreview artifact={active} />
        ) : (
          <div className="grid min-h-64 place-items-center text-muted-foreground">
            <Sparkles className="icon-lg" />
          </div>
        )}
      </PreviewSheet>
    </div>
  )
}

export { previewSrcDoc }
