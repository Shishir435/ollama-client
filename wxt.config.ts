import { defineConfig } from "wxt"
import { hooks } from "./config/wxt-hooks"
import { vite } from "./config/wxt-vite"
import packageJson from "./package.json"

/*
 * Manifest stays here by design: permissions, CSP, host permissions, and
 * browser_specific_settings live in exactly one place (see AGENTS.md). The
 * hooks and vite blocks moved to ./config because they carry build logic worth
 * unit-testing on its own — which the manifest does not.
 */

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
  hooks,
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

  vite
})
