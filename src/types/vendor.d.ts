// Ambient declarations for untyped vendor modules.
// These ship no types and have no @types package; declaring them keeps
// strict-mode `noImplicitAny` happy without falling back to blanket `any`.

declare module "markdown-it-deflist" {
  import type { PluginSimple } from "markdown-it"

  const plugin: PluginSimple
  export default plugin
}

declare module "markdown-it-mark" {
  import type { PluginSimple } from "markdown-it"

  const plugin: PluginSimple
  export default plugin
}

declare module "markdown-it-sub" {
  import type { PluginSimple } from "markdown-it"

  const plugin: PluginSimple
  export default plugin
}

declare module "markdown-it-sup" {
  import type { PluginSimple } from "markdown-it"

  const plugin: PluginSimple
  export default plugin
}

declare module "markdown-it-task-lists" {
  import type { PluginWithOptions } from "markdown-it"

  interface TaskListsOptions {
    enabled?: boolean
    label?: boolean
    labelAfter?: boolean
  }
  const plugin: PluginWithOptions<TaskListsOptions>
  export default plugin
}

// Side-effect-only import to register the pdf.js worker; exposes no bindings.
declare module "pdfjs-dist/build/pdf.worker.min.mjs" {
  const worker: unknown
  export default worker
}

// Vite `?url` asset import for the official SQLite WASM binary, used by the
// section 9.4 OPFS spike worker.
declare module "@sqlite.org/sqlite-wasm/sqlite3.wasm?url" {
  const url: string
  export default url
}
