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
  manifest: {
    name: packageJson.name,
    description: packageJson.description,
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
      "declarativeNetRequest",
      "contextMenus"
    ],
    web_accessible_resources: [
      {
        resources: ["assets/*.wasm"],
        matches: ["<all_urls>"]
      }
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' http://localhost:* http://127.0.0.1:*; object-src 'self'"
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
      plugins: [react(), visualizer({ open: false, filename: "stats.html" })]
    }) as unknown as WxtViteConfig
})
