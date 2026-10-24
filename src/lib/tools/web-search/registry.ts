import { braveBackend } from "./backends/brave"
import { ollamaBackend } from "./backends/ollama"
import { searxngBackend } from "./backends/searxng"
import { tavilyBackend } from "./backends/tavily"
import type { WebSearchBackend, WebSearchProviderId } from "./types"

const BACKENDS: Record<WebSearchProviderId, WebSearchBackend> = {
  searxng: searxngBackend,
  brave: braveBackend,
  tavily: tavilyBackend,
  ollama: ollamaBackend
}

export const getWebSearchBackend = (id: string): WebSearchBackend | undefined =>
  BACKENDS[id as WebSearchProviderId]

export const listWebSearchBackends = (): WebSearchBackend[] =>
  Object.values(BACKENDS)
