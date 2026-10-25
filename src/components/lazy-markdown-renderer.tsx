import { lazy, Suspense } from "react"
import type { ComponentProps } from "react"
import type { MarkdownRenderer as Renderer } from "./markdown-renderer"

const MarkdownRenderer = lazy(() =>
  import("./markdown-renderer").then((module) => ({
    default: module.MarkdownRenderer
  }))
)

/** Keep parsing and image controls deferred until chat content is displayed. */
export const LazyMarkdownRenderer = (
  props: ComponentProps<typeof Renderer>
) => (
  <Suspense
    fallback={<span className="whitespace-pre-wrap">{props.content}</span>}>
    <MarkdownRenderer {...props} />
  </Suspense>
)
