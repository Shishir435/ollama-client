import { defineConfig } from "astro/config"
import { fileURLToPath } from "url"

export default defineConfig({
  site: "https://ollama-client.shishirchaurasiya.in",
  base: "/",
  trailingSlash: "ignore",
  outDir: "../docs",
  build: {
    format: "directory"
  },
  integrations: [],
  vite: {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    }
  }
})
