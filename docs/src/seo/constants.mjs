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

/**
 * True on a deploy that is not production.
 *
 * Preview deployments resolve `SITE_URL` from `VERCEL_URL`, so every page
 * canonicalizes to the preview host while `robots.txt` says `Allow: /` — a
 * complete indexable copy of the site on a throwaway domain. Vercel does add
 * `X-Robots-Tag: noindex` to preview deployments by default, which is why this
 * has most likely never bitten; that is a platform default we neither control
 * nor test, and stating the intent in the build costs one meta tag.
 *
 * Local builds are unaffected: the flag reads as production unless `VERCEL_ENV`
 * is present and says otherwise, so `pnpm docs:build` on a laptop behaves
 * exactly as it did.
 */
export const IS_NON_PRODUCTION_DEPLOY = Boolean(
  process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production"
)

export const SITE_TITLE = "Ollama Client"

export const REPO_URL = "https://github.com/Shishir435/ollama-client"

export const CONTACT_EMAIL = "shishirchaurasiya435@gmail.com"

export const AUTHOR_NAME = "Shishir Chaurasiya"

export const AUTHOR_URL = "https://www.shishirchaurasiya.in/"

export const SITE_DESCRIPTION =
  "Privacy-first browser extension for local LLM chat with Ollama, LM Studio, llama.cpp, and OpenAI-compatible servers."

export const LANDING_TITLE =
  "Ollama Client — Ollama browser extension for local AI"

export const LANDING_DESCRIPTION =
  "Use verified Ollama, LM Studio, and llama.cpp profiles, or add OpenAI-compatible endpoints and Anthropic, inside Chrome and Firefox."

export const KEYWORDS =
  "ollama browser extension, local llm browser extension, chrome extension for ollama, lm studio browser extension, open webui alternative, local ai assistant, offline ai browser, private ai chat, local rag, browser ai agent, self-hosted ai, firefox extension, llama.cpp, vllm, localai, koboldcpp, openai compatible, open source"
