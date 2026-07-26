import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { visualizer } from "rollup-plugin-visualizer"
import { defineConfig } from "wxt"
import packageJson from "./package.json"

type WxtViteFactory = NonNullable<Parameters<typeof defineConfig>[0]["vite"]>
type WxtViteConfig = ReturnType<WxtViteFactory>

export default defineConfig({
  manifestVersion: 3,
  srcDir: "src",
  outDir: process.env.WXT_OUTPUT_DIR || "build",
  outDirTemplate: "",
  publicDir: "public",
  imports: false,
  zip: {
    exclude: ["assets/icon-promo-light.png"]
  },
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      const promoIndex = files.findIndex(
        (file) => file.relativeDest === "assets/icon-promo-light.png"
      )
      if (promoIndex !== -1) files.splice(promoIndex, 1)
      // Ship the official sqlite3.wasm at a stable path: the persistence
      // owner host fetches it and hands bytes to its worker. Bundler ?url
      // imports are not portable here — Firefox MV2 iife output inlines the
      // asset as a data: URL, which fetch() rejects.
      files.push({
        absoluteSrc: resolve(
          "node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm"
        ),
        relativeDest: "assets/sqlite3.wasm"
      })
    },
    // The persistence benchmark and OPFS spike pages are dev tools for the
    // section 9.8/9.4 browser measurements. Keep them out of store packages:
    // they only build in dev mode or when WXT_BENCHMARK=1 is set explicitly.
    "entrypoints:resolved": (wxt, entrypoints) => {
      const includeBenchmark =
        wxt.config.command === "serve" || process.env.WXT_BENCHMARK === "1"
      // The owner-topology spike depends on chrome.offscreen and
      // chrome.runtime.getContexts, which Firefox does not provide; its two
      // pages are Chromium-only even in benchmark builds. The measurement
      // pages (benchmark, spike-opfs) stay cross-browser.
      // Firefox hosts the owner in its persistent background page, so it
      // keeps the client page but never ships the Chromium offscreen page.
      const devOnly = includeBenchmark
        ? wxt.config.browser === "firefox"
          ? ["spike-owner-offscreen"]
          : []
        : [
            "benchmark",
            "spike-opfs",
            "spike-owner",
            "spike-owner-offscreen",
            "persistence-verify"
          ]
      // The production persistence owner document is Chromium-only; Firefox
      // hosts the worker in its persistent background page.
      const strip =
        wxt.config.browser === "firefox"
          ? [...devOnly, "persistence-host"]
          : devOnly
      for (const name of strip) {
        const index = entrypoints.findIndex(
          (entrypoint) => entrypoint.name === name
        )
        if (index !== -1) entrypoints.splice(index, 1)
      }
    }
  },
  manifest: ({ browser }) => ({
    name: "__MSG_extName__",
    short_name: "__MSG_extShortName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    version: packageJson.version,
    // The Chromium persistence owner uses chrome.offscreen (Chrome 109+) and
    // chrome.runtime.getContexts (Chrome 116+); 116 is the real floor for
    // durable chat history on Chromium, so the manifest states it honestly.
    ...(browser === "firefox" ? {} : { minimum_chrome_version: "116" }),
    homepage_url: packageJson.homepage,
    icons: {
      16: "assets/icon.png",
      32: "assets/icon.png",
      48: "assets/icon.png",
      64: "assets/icon.png",
      128: "assets/icon.png"
    },
    action: {
      default_title: "__MSG_actionDefaultTitle__",
      default_icon: {
        16: "assets/icon.png",
        32: "assets/icon.png",
        48: "assets/icon.png",
        64: "assets/icon.png",
        128: "assets/icon.png"
      }
    },
    omnibox: {
      keyword: "olc"
    },
    host_permissions: ["<all_urls>"],
    permissions: [
      "storage",
      // Chat history, vectors, and (0.12.4+) OPFS SQLite share the extension
      // origin's quota; unlimitedStorage removes eviction risk and, on
      // Firefox, makes the storage persistent without a user prompt. It adds
      // no install-time permission warning.
      "unlimitedStorage",
      "tabs",
      "scripting",
      "contextMenus",
      // offscreen: production permission — the hidden document that hosts
      // the single SQLite worker owning durable chat history (Chromium only).
      ...(browser === "firefox"
        ? []
        : ["sidePanel", "declarativeNetRequest", "offscreen"])
    ],
    // Optional API permissions requested from the Permissions UI.
    // Declared so they can be requested at runtime via src/lib/permissions.ts;
    // NOT granted until a feature asks the user. Standing `permissions` stays
    // minimal. Host access (`<all_urls>`) is intentionally not optional.
    optional_permissions: [
      "bookmarks",
      "history",
      "notifications",
      "downloads",
      "tabGroups",
      "alarms",
      "sessions"
    ],
    // Browser-level keyboard command. Uses the reserved
    // `_execute_action` so the hotkey mirrors a toolbar-icon click: with
    // `openPanelOnActionClick`, that TOGGLES the side panel (open and close),
    // which a custom command calling `sidePanel.open()` cannot do. Rebindable at
    // chrome://extensions/shortcuts; the browser may drop the default on conflict.
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Alt+Shift+O",
          mac: "Command+Shift+O"
        }
      }
    },
    web_accessible_resources: [
      {
        resources: ["assets/*.wasm", "chunks/*.js", "content-scripts/*.css"],
        matches: ["<all_urls>"]
      }
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' http://*:* https://*:* ws://*:* wss://*:*; object-src 'self'"
    },
    browser_specific_settings: {
      gecko: {
        id: "shishirchaurasiya435@gmail.com",
        strict_min_version: "113.0",
        data_collection_permissions: {
          required: ["none"]
        }
      }
    }
  }),

  vite: (env) =>
    ({
      // Compile-time flag for the dev-only section 9.4 spike host in the
      // background entry; false in store builds — and in Firefox benchmark
      // builds, which lack the offscreen API — so the branch and its dynamic
      // import are dead-code eliminated.
      define: {
        __SPIKE_OPFS_OWNER__: JSON.stringify(
          process.env.WXT_BENCHMARK === "1" && env.browser !== "firefox"
        ),
        __SPIKE_OPFS_OWNER_MV2__: JSON.stringify(
          process.env.WXT_BENCHMARK === "1" && env.browser === "firefox"
        ),
        // Persistence owner topology, resolved at build time so the unused
        // branch (and its ~1.4 MB SQLite worker chunk) is dead-code eliminated
        // from the background entry. Firefox MV2 hosts the worker in its
        // persistent background page; Chromium delegates to the offscreen
        // document, so its background never bundles the worker.
        __FIREFOX_BG_OWNER__: JSON.stringify(env.browser === "firefox")
      },
      plugins: [
        // Drop the content-hashed sqlite3-<hash>.wasm that the sqlite-wasm
        // emscripten glue's `new URL("sqlite3.wasm", import.meta.url)` makes
        // the bundler emit. It is byte-identical to the stable
        // assets/sqlite3.wasm we copy in `build:publicAssets`, and the worker
        // inits with wasmBinary from that stable copy, so the glue never
        // fetches the hashed URL. Removing it at generateBundle means it is
        // never written, never recorded in the manifest, and never packaged —
        // no ENOENT warning, single copy in both the unpacked build and zip.
        {
          name: "wxt:drop-redundant-sqlite-wasm",
          generateBundle(_options, bundle) {
            for (const fileName of Object.keys(bundle)) {
              if (/(^|\/)sqlite3-[^/]*\.wasm$/.test(fileName)) {
                delete bundle[fileName]
              }
            }
          }
        },
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
})
