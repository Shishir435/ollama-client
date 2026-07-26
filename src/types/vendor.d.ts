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

// Compile-time flag defined in wxt.config.ts vite `define`; true only for
// WXT_BENCHMARK=1 builds that carry the section 9.4 spike owner host.
declare const __SPIKE_OPFS_OWNER__: boolean

// True only for WXT_BENCHMARK=1 Firefox builds: the MV2 background page
// hosts the section 9.4 spike owner worker directly (no offscreen API).
declare const __SPIKE_OPFS_OWNER_MV2__: boolean

// Compile-time flag defined in wxt.config.ts vite `define`; true only for
// Firefox (MV2) builds, whose persistent background page hosts the SQLite
// persistence worker directly. On Chromium (false) the offscreen document is
// the owner, so this lets the bundler dead-code-eliminate the owner-host +
// worker chunk out of the Chromium background entry.
declare const __FIREFOX_BG_OWNER__: boolean
