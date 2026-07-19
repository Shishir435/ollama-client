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
  zip: {
    exclude: ["assets/icon-promo-light.png"]
  },
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      const promoIndex = files.findIndex(
        (file) => file.relativeDest === "assets/icon-promo-light.png"
      )
      if (promoIndex !== -1) files.splice(promoIndex, 1)
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
      const strip = includeBenchmark
        ? wxt.config.browser === "firefox"
          ? ["spike-owner", "spike-owner-offscreen"]
          : []
        : ["benchmark", "spike-opfs", "spike-owner", "spike-owner-offscreen"]
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
    ...(browser === "firefox" ? {} : { minimum_chrome_version: "88" }),
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
      ...(browser === "firefox" ? [] : ["sidePanel", "declarativeNetRequest"]),
      // Dev-only: the section 9.4 spike's offscreen owner document. Never in
      // store packages — gated by the same flag as the spike entrypoints.
      ...(browser !== "firefox" && process.env.WXT_BENCHMARK === "1"
        ? ["offscreen"]
        : [])
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
        )
      },
      plugins: [
        react({
          babel: {
            plugins: [["babel-plugin-react-compiler"]]
          }
        }),
        visualizer({ open: false, filename: "stats.html" })
      ]
    }) as WxtViteConfig
})
