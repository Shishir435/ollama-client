import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const findAppPackageJson = () => {
  const startDirs = [
    process.cwd(),
    dirname(fileURLToPath(import.meta.url))
  ].map((dir) => resolve(dir))

  for (const startDir of startDirs) {
    let currentDir = startDir

    while (true) {
      const packagePath = join(currentDir, "package.json")

      if (existsSync(packagePath)) {
        const candidate = JSON.parse(readFileSync(packagePath, "utf-8"))
        if (candidate.name === "ollama-client") return candidate
      }

      const parentDir = dirname(currentDir)
      if (parentDir === currentDir) break
      currentDir = parentDir
    }
  }

  throw new Error("Could not find root ollama-client package.json")
}

const packageJson = findAppPackageJson()

export const APP_VERSION = packageJson.version

export const SITE_URL = "https://ollama-client.shishirchaurasiya.in"

export const SITE_TITLE = "Ollama Client"

export const SITE_DESCRIPTION =
  "Privacy-first browser extension for local LLM chat with Ollama, LM Studio, llama.cpp, and OpenAI-compatible servers."

export const LANDING_TITLE = "Ollama Client — Local AI chat in your browser"

export const LANDING_DESCRIPTION = `${SITE_DESCRIPTION} Local-first by design.`

export const KEYWORDS =
  "ollama, local llm, browser extension, chrome extension, firefox extension, side panel, rag, embeddings, local-first, privacy, lm studio, llama.cpp, openai compatible, open source"
