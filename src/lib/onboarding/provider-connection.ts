import type { ProviderConfig } from "@/lib/providers/types"
import { ProviderType } from "@/lib/providers/types"

export const OLLAMA_CORS_COMMAND =
  'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve'

export type ProviderConnectionResult =
  | { kind: "connected"; modelCount: number }
  | {
      kind:
        | "cors"
        | "auth"
        | "not-found"
        | "timeout"
        | "unavailable"
        | "server-error"
      status?: number
    }

const connectionEndpoint = (config: ProviderConfig): string => {
  const baseUrl = (config.baseUrl || "http://localhost:11434").replace(
    /\/+$/,
    ""
  )
  return config.type === ProviderType.OLLAMA
    ? `${baseUrl}/api/tags`
    : `${baseUrl}/models`
}

/**
 * Lightweight first-run connection check with actionable failure classes.
 * Network errors cannot distinguish a stopped localhost server from a browser
 * CORS rejection, so they deliberately remain one honest "unavailable" class.
 */
export const checkProviderConnection = async (
  config: ProviderConfig,
  timeoutMs = 8000
): Promise<ProviderConnectionResult> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(connectionEndpoint(config), {
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : undefined,
      signal: controller.signal
    })
    if (response.status === 401 || response.status === 403) {
      return config.baseUrl?.includes("localhost") ||
        config.baseUrl?.includes("127.0.0.1")
        ? { kind: "cors", status: response.status }
        : { kind: "auth", status: response.status }
    }
    if (response.status === 404) {
      return { kind: "not-found", status: response.status }
    }
    if (!response.ok) {
      return { kind: "server-error", status: response.status }
    }
    const payload = (await response.json()) as {
      models?: unknown[]
      data?: unknown[]
    }
    return {
      kind: "connected",
      modelCount: Array.isArray(payload.models)
        ? payload.models.length
        : Array.isArray(payload.data)
          ? payload.data.length
          : 0
    }
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError"
      ? { kind: "timeout" }
      : { kind: "unavailable" }
  } finally {
    clearTimeout(timer)
  }
}
