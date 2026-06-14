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
