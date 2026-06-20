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
    }
  },
  manifest: {
    name: "__MSG_extName__",
    short_name: "__MSG_extShortName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    version: packageJson.version,
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
    host_permissions: ["<all_urls>"],
    permissions: [
      "storage",
      "sidePanel",
      "tabs",
      "scripting",
      "declarativeNetRequest",
      "contextMenus"
    ],
    // Optional API permissions (v0.11.0 groundwork — FEATURE_ROADMAP §5 item 2).
    // Declared so they can be requested at runtime via src/lib/permissions.ts;
    // NOT granted until a feature asks the user. Standing `permissions` stays
    // minimal. Host access (`<all_urls>`) is intentionally NOT optional — see §0.4.
    //   bookmarks/history -> E2   notifications -> E5   downloads -> E9   tabGroups -> E4
    optional_permissions: [
      "bookmarks",
      "history",
      "notifications",
      "downloads",
      "tabGroups"
    ],
    // Browser-level keyboard command (v0.11.1 / F2). Uses the reserved
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
        strict_min_version: "113.0"
      }
    }
  },

  vite: () =>
    ({
      plugins: [
        react({
          babel: {
            plugins: [["babel-plugin-react-compiler"]]
          }
        }),
        visualizer({ open: false, filename: "stats.html" })
      ]
    }) as unknown as WxtViteConfig
})
