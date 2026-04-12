import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

export const readJsonBody = async <T>(request: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim()
  if (!raw) {
    throw new Error("Request body is empty")
  }

  return JSON.parse(raw) as T
}

export const writeJson = (
  response: ServerResponse,
  statusCode: number,
  payload: unknown
) => {
  response.statusCode = statusCode
  response.setHeader("Content-Type", "application/json")
  response.end(`${JSON.stringify(payload)}\n`)
}

export const createCompletionId = () => `chatcmpl-${randomUUID()}`

export const unixSeconds = () => Math.floor(Date.now() / 1000)
