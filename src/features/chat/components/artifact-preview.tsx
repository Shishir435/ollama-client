import { useTranslation } from "react-i18next"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ChatArtifact } from "@/lib/artifacts"
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

export const ArtifactPreview = ({ artifact }: { artifact: ChatArtifact }) => {
  const { t } = useTranslation()

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
        emptyText={t("chat.artifacts.empty")}
        className="font-mono text-2xs"
      />
    </ScrollArea>
  )
}

export { previewSrcDoc }
