import react from "@vitejs/plugin-react"
import { visualizer } from "rollup-plugin-visualizer"
import type { defineConfig } from "wxt"

type WxtViteFactory = NonNullable<Parameters<typeof defineConfig>[0]["vite"]>
type WxtViteConfig = ReturnType<WxtViteFactory>

export interface DefineTarget {
  browser: string
  /** process.env.WXT_SPIKE_OWNER, passed in rather than read, so this is pure. */
  spikeOwner: boolean
}

/**
 * Build-time flags that decide which persistence owner the background entry
 * registers, and therefore which owner-shaped chunk it bundles at all.
 *
 * `__SPIKE_OPFS_OWNER__` / `__SPIKE_OPFS_OWNER_MV2__` are gated on
 * WXT_SPIKE_OWNER and NOT on WXT_BENCHMARK, because the two dev surfaces want
 * opposite things from the owner slot. The spike pages need the spike host to
 * own it; persistence-verify.html exists to drive the PRODUCTION owner and
 * proves nothing if that owner stood down. Both pages ship under
 * WXT_BENCHMARK, so while one flag drove both, `pnpm verify:opfs-migration`
 * could only ever run against an absent owner — it reported "Backend marker
 * never became opfs: null" on its first scenario from PR #200 until the flags
 * were split. Use `pnpm spike:build` for the spike runners and
 * `pnpm benchmark:build` for the verify runners.
 *
 * `__FIREFOX_BG_OWNER__` resolves the production topology at build time so the
 * unused branch — and its ~1.4 MB SQLite worker chunk — is dead-code
 * eliminated. Firefox MV2 hosts the worker in its persistent background page;
 * Chromium delegates to the offscreen document, so its background never
 * bundles the worker.
 *
 * Pure so the matrix can be asserted directly — see
 * config/__tests__/wxt-build-config.test.ts. Nothing tested it when PR #200
 * changed it, which is why the regression above survived a release.
 */
export const persistenceDefines = (
  target: DefineTarget
): Record<string, string> => ({
  __SPIKE_OPFS_OWNER__: JSON.stringify(
    target.spikeOwner && target.browser !== "firefox"
  ),
  __SPIKE_OPFS_OWNER_MV2__: JSON.stringify(
    target.spikeOwner && target.browser === "firefox"
  ),
  __FIREFOX_BG_OWNER__: JSON.stringify(target.browser === "firefox"),
  /**
   * Agent Preview is a Chromium product surface. Keeping this compile-time
   * means Firefox bundles contain neither its UI nor its background runtime.
   */
  __AGENT_PREVIEW_ENABLED__: JSON.stringify(target.browser !== "firefox")
})

/**
 * Drop the content-hashed sqlite3-<hash>.wasm that the sqlite-wasm emscripten
 * glue's `new URL("sqlite3.wasm", import.meta.url)` makes the bundler emit.
 *
 * It is byte-identical to the stable assets/sqlite3.wasm copied in
 * `build:publicAssets`, and the worker inits with wasmBinary from that stable
 * copy, so the glue never fetches the hashed URL. Removing it at generateBundle
 * means it is never written, never recorded in the manifest, and never packaged
 * — no ENOENT warning, single copy in both the unpacked build and the zip.
 */
const dropRedundantSqliteWasm = {
  name: "wxt:drop-redundant-sqlite-wasm",
  generateBundle(_options: unknown, bundle: Record<string, unknown>) {
    for (const fileName of Object.keys(bundle)) {
      if (/(^|\/)sqlite3-[^/]*\.wasm$/.test(fileName)) {
        delete bundle[fileName]
      }
    }
  }
}

/**
 * No `<link rel="modulepreload">` in extension pages.
 *
 * Preload hints exist to start a network fetch before the import graph asks
 * for it. Extension chunks are already on local disk, so the hint buys nothing
 * measurable — and Chrome charges for it twice in the console: once per chunk
 * that is not evaluated within a few seconds of load (the offscreen host
 * evaluates almost nothing itself; its work is in a Worker), and once per
 * "cross-world extension resource mismatch", because a preload issued in one
 * extension world does not satisfy a fetch from another. That was 46 warnings
 * on a single page load, drowning the extension's own logs.
 *
 * `false` disables the preload links and the polyfill together. Chunks still
 * load, on demand through the module graph, which is what was happening
 * anyway.
 */
export const vite: WxtViteFactory = (env) =>
  ({
    build: { modulePreload: false },
    define: persistenceDefines({
      browser: env.browser,
      spikeOwner: process.env.WXT_SPIKE_OWNER === "1"
    }),
    plugins: [
      dropRedundantSqliteWasm,
      react({
        exclude: [/node_modules/, /src\/i18n\/resources\.ts$/],
        babel: {
          plugins: [["babel-plugin-react-compiler"]]
        }
      }),
      ...(process.env.WXT_ANALYZE === "1"
        ? [visualizer({ open: false, filename: "stats.html" })]
        : [])
    ]
  }) as WxtViteConfig
