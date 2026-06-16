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
        if (candidate.name === "ollama-client") {
          return {
            path: packagePath,
            packageJson: candidate
          }
        }
      }

      const parentDir = dirname(currentDir)
      if (parentDir === currentDir) break
      currentDir = parentDir
    }
  }

  throw new Error("Could not find root ollama-client package.json")
}

const appPackage = findAppPackageJson()
const appRoot = dirname(appPackage.path)

const loadEnvFile = (path) => {
  if (!existsSync(path)) return

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/)
    if (!match || process.env[match[1]] !== undefined) continue

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
  }
}

for (const envPath of [
  join(appRoot, ".env"),
  join(appRoot, ".env.local"),
  join(appRoot, "docs/.env"),
  join(appRoot, "docs/.env.local")
]) {
  loadEnvFile(envPath)
}

export const APP_VERSION = appPackage.packageJson.version

const DEFAULT_SITE_URL = "https://www.ollamaclient.in"

const normalizeSiteUrl = (url) => {
  const trimmed = (url || DEFAULT_SITE_URL).trim().replace(/\/+$/, "")
  if (!trimmed) return DEFAULT_SITE_URL
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

export const SITE_URL = normalizeSiteUrl(
  process.env.PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL
)

export const SITE_TITLE = "Ollama Client"

export const SITE_DESCRIPTION =
  "Privacy-first browser extension for local LLM chat with Ollama, LM Studio, llama.cpp, and OpenAI-compatible servers."

export const LANDING_TITLE = "Ollama Client — Local AI chat in your browser"

export const LANDING_DESCRIPTION = `${SITE_DESCRIPTION} Local-first by design.`

export const KEYWORDS =
  "ollama, local llm, browser extension, chrome extension, firefox extension, side panel, rag, embeddings, local-first, privacy, lm studio, llama.cpp, openai compatible, open source"
