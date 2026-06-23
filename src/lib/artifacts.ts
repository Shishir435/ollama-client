export type ArtifactKind = "html" | "svg" | "mermaid" | "code"

export interface ChatArtifact {
  id: string
  kind: ArtifactKind
  language: string
  title: string
  content: string
  renderable: boolean
}

const FENCED_CODE_BLOCK_RE = /```([^\n`]*)\n([\s\S]*?)```/g
const MAX_ARTIFACT_CHARS = 120_000

const LANGUAGE_ALIASES: Record<string, string> = {
  htm: "html",
  mmd: "mermaid",
  javascript: "js",
  typescript: "ts"
}

const CODE_LANGUAGES = new Set([
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "python",
  "py",
  "bash",
  "sh",
  "sql",
  "rust",
  "go",
  "java",
  "kotlin",
  "swift",
  "php",
  "ruby",
  "yaml",
  "yml"
])

const normalizeLanguage = (raw: string): string => {
  const token = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  return LANGUAGE_ALIASES[token] ?? token
}

const inferKind = (language: string, content: string): ArtifactKind | null => {
  const trimmed = content.trimStart()
  if (language === "html" || /^<!doctype html\b|^<html[\s>]/i.test(trimmed)) {
    return "html"
  }
  if (language === "svg" || /^<svg[\s>]/i.test(trimmed)) return "svg"
  if (language === "mermaid") return "mermaid"
  if (CODE_LANGUAGES.has(language)) return "code"
  return null
}

const titleFor = (kind: ArtifactKind, language: string, index: number) => {
  if (kind === "html") return `HTML artifact ${index}`
  if (kind === "svg") return `SVG artifact ${index}`
  if (kind === "mermaid") return `Mermaid diagram ${index}`
  return `${language || "Code"} artifact ${index}`
}

export const createChatArtifactFromCodeBlock = ({
  code,
  language,
  index
}: {
  code: string
  language: string
  index: number
}): ChatArtifact | null => {
  const normalizedLanguage = normalizeLanguage(language)
  const content = code.trim()
  if (!content) return null

  const kind = inferKind(normalizedLanguage, content)
  if (!kind) return null

  return {
    id: `${kind}-${index}`,
    kind,
    language: normalizedLanguage || kind,
    title: titleFor(kind, normalizedLanguage, index),
    content: content.slice(0, MAX_ARTIFACT_CHARS),
    renderable: kind === "html" || kind === "svg" || kind === "mermaid"
  }
}

export const extractChatArtifacts = (content: string): ChatArtifact[] => {
  const artifacts: ChatArtifact[] = []
  for (const match of content.matchAll(FENCED_CODE_BLOCK_RE)) {
    const code = (match[2] ?? "").trim()
    const artifact = createChatArtifactFromCodeBlock({
      code,
      language: match[1] ?? "",
      index: artifacts.length + 1
    })
    if (artifact) artifacts.push(artifact)
  }
  return artifacts
}
