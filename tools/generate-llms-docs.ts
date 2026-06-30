#!/usr/bin/env tsx
/**
 * Generates static Markdown entrypoints for AI agents.
 *
 * Output lives in docs/public so Vercel serves:
 * - /llms.txt
 * - /llms-full.txt
 * - /ai.txt
 * - /<docs-page>.md
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  SITE_DESCRIPTION,
  SITE_TITLE,
  SITE_URL
} from "../docs/src/seo/constants.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const DOCS_CONTENT_DIR = join(REPO_ROOT, "docs/src/content/docs")
const PUBLIC_DIR = join(REPO_ROOT, "docs/public")

type DocPage = {
  title: string
  description: string
  slug: string
  sourcePath: string
  markdownPath: string
  url: string
  markdownUrl: string
  body: string
}

const DOC_ORDER = [
  "about/faq",
  "guides/quick-start",
  "guides/provider-setup",
  "guides/troubleshooting/ollama-cors-error",
  "concepts/privacy",
  "concepts/architecture",
  "concepts/provider-matrix",
  "internal/frontend-design-system",
  "legal/privacy-policy",
  "about/changelog",
  "about/keyboard-shortcuts"
]

function walk(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return walk(path)
      return path
    })
    .filter((path) => /\.(md|mdx)$/.test(path))
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) {
    return { data: new Map<string, string>(), body: markdown }
  }

  const data = new Map<string, string>()
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!field) continue
    data.set(field[1], field[2].replace(/^["']|["']$/g, "").trim())
  }

  return { data, body: markdown.slice(match[0].length) }
}

function routeFromSource(path: string) {
  const rel = relative(DOCS_CONTENT_DIR, path).replace(/\\/g, "/")
  const withoutExt = rel.replace(/\.(md|mdx)$/, "")
  return withoutExt.endsWith("/index")
    ? withoutExt.slice(0, -"/index".length)
    : withoutExt
}

function stripMdxExportDeclarations(body: string) {
  const lines = body.split("\n")
  const cleaned: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*export\s+(?:const|let|var)\s+/.test(lines[index])) {
      cleaned.push(lines[index])
      continue
    }

    let depth = 0
    let quote: '"' | "'" | "`" | null = null
    let escaped = false

    do {
      const line = lines[index]
      for (const char of line) {
        if (escaped) {
          escaped = false
          continue
        }
        if (quote) {
          if (char === "\\") escaped = true
          else if (char === quote) quote = null
          continue
        }
        if (char === '"' || char === "'" || char === "`") {
          quote = char
        } else if (char === "{" || char === "[" || char === "(") {
          depth += 1
        } else if (char === "}" || char === "]" || char === ")") {
          depth -= 1
        }
      }
      index += 1
    } while (index < lines.length && (depth > 0 || quote))

    index -= 1
  }

  return cleaned.join("\n")
}

export function cleanMarkdown(body: string) {
  return stripMdxExportDeclarations(body)
    .replace(/^import\s+.*$/gm, "")
    .replace(/<FAQPageJsonLd\b[^>]*\/>/g, "")
    .replace(
      /<([A-Z][A-Za-z0-9.]*)\b[^>]*>([\s\S]*?)<\/\1>/g,
      "\n\n$2\n\n"
    )
    .replace(
      /<([A-Z][A-Za-z0-9.]*)\b[^>]*\/>/g,
      "_Rendered component: $1._"
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function sortPages(a: DocPage, b: DocPage) {
  const aIndex = DOC_ORDER.indexOf(a.slug)
  const bIndex = DOC_ORDER.indexOf(b.slug)
  if (aIndex !== -1 || bIndex !== -1) {
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1
    return aIndex - bIndex
  }
  return a.slug.localeCompare(b.slug)
}

function loadPages() {
  return walk(DOCS_CONTENT_DIR)
    .filter((path) => !relative(DOCS_CONTENT_DIR, path).startsWith("reference/"))
    .map((sourcePath) => {
      const raw = readFileSync(sourcePath, "utf-8")
      const { data, body } = parseFrontmatter(raw)
      const slug = routeFromSource(sourcePath)
      const title = data.get("title") || slug
      const description = data.get("description") || SITE_DESCRIPTION
      const url = `${SITE_URL}/${slug}/`
      const markdownUrl = `${SITE_URL}/${slug}.md`
      const markdownPath = join(PUBLIC_DIR, `${slug}.md`)

      return {
        title,
        description,
        slug,
        sourcePath,
        markdownPath,
        url,
        markdownUrl,
        body: cleanMarkdown(body)
      }
    })
    .sort(sortPages)
}

function pageMarkdown(page: DocPage) {
  return `# ${page.title}

Source: ${page.url}
Markdown: ${page.markdownUrl}
Description: ${page.description}

${page.body}
`
}

function writePageMarkdown(pages: DocPage[]) {
  for (const page of pages) {
    mkdirSync(dirname(page.markdownPath), { recursive: true })
    writeFileSync(page.markdownPath, pageMarkdown(page), "utf-8")
  }
}

function writeLlmsTxt(pages: DocPage[]) {
  const lines = pages.map(
    (page) => `- [${page.title}](${page.markdownUrl}): ${page.description}`
  )

  const content = `# ${SITE_TITLE}

> ${SITE_DESCRIPTION}

Ollama Client is a local-first browser extension for private LLM chat, provider management, and local RAG workflows.

## Docs

${lines.join("\n")}

## Reference

- [API Reference](${SITE_URL}/reference/): Generated TypeScript API reference.
- [Full Markdown Docs](${SITE_URL}/llms-full.txt): All public docs in one Markdown file.
- [GitHub Repository](https://github.com/Shishir435/ollama-client): Source code and issue tracker.
`

  writeFileSync(join(PUBLIC_DIR, "llms.txt"), content, "utf-8")
}

function writeLlmsFullTxt(pages: DocPage[]) {
  const sections = pages.map(pageMarkdown)
  const content = `# ${SITE_TITLE} Full Documentation

Source: ${SITE_URL}

${SITE_DESCRIPTION}

${sections.join("\n---\n\n")}
`

  writeFileSync(join(PUBLIC_DIR, "llms-full.txt"), content, "utf-8")
}

function writeAiTxt(pages: DocPage[]) {
  const lines = pages.map(
    (page) => `- ${page.title}: ${page.markdownUrl}`
  )

  const content = `# AI crawler guidance for ${SITE_TITLE}

Purpose: Help AI agents fetch clean, canonical documentation without parsing HTML navigation, CSS, or scripts.

Canonical site: ${SITE_URL}
Primary AI docs index: ${SITE_URL}/llms.txt
Full Markdown docs: ${SITE_URL}/llms-full.txt
Sitemap: ${SITE_URL}/sitemap-index.xml
Repository: https://github.com/Shishir435/ollama-client

Preferred fetch order:
1. Fetch /llms.txt for the docs map.
2. Fetch linked .md pages for targeted answers.
3. Fetch /llms-full.txt only when broad project context is needed.
4. Use canonical HTML pages for citations shown to users.

Markdown pages:
${lines.join("\n")}
`

  writeFileSync(join(PUBLIC_DIR, "ai.txt"), content, "utf-8")
}

function cleanOldMarkdown() {
  rmSync(join(PUBLIC_DIR, "llms.txt"), { force: true })
  rmSync(join(PUBLIC_DIR, "llms-full.txt"), { force: true })
  rmSync(join(PUBLIC_DIR, "ai.txt"), { force: true })

  for (const path of walk(PUBLIC_DIR)) {
    if (path.endsWith(".md")) {
      rmSync(path, { force: true })
    }
  }
}

function main() {
  console.log("Generating AI-readable docs...")
  cleanOldMarkdown()

  const pages = loadPages()
  writePageMarkdown(pages)
  writeLlmsTxt(pages)
  writeLlmsFullTxt(pages)
  writeAiTxt(pages)

  console.log(`Generated llms.txt, llms-full.txt, ai.txt, and ${pages.length} page markdown files`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
