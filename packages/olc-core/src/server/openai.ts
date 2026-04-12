import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { RuntimeContext } from "../runtime"
import { getHealthReport } from "../services/doctor"
import { listModels } from "../services/models"
import type { ChatMessage, ChatRequest } from "../types"
import {
  createCompletionId,
  readJsonBody,
  unixSeconds,
  writeJson
} from "../utils/http"

type OpenAIChatCompletionRequest = {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  provider?: string
}

const toStatusCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes("not configured") ||
    message.includes("disabled") ||
    message.includes("not found") ||
    message.includes("empty")
  ) {
    return 400
  }
  return 502
}

export const startOpenAIServer = async (options?: {
  host?: string
  port?: number
  runtime?: RuntimeContext
}) => {
  const host = options?.host ?? "127.0.0.1"
  const port = options?.port ?? 11435
  const runtime = options?.runtime || new RuntimeContext()

  const server = createServer(async (request, response) => {
    try {
      const method = request.method || "GET"
      const url = request.url || "/"

      if (method === "GET" && url === "/healthz") {
        const report = await getHealthReport(runtime)
        writeJson(response, 200, {
          ok: true,
          time: new Date().toISOString(),
          uptimeSeconds: process.uptime(),
          configPath: report.configPath,
          providers: report.providers
        })
        return
      }

      if (method === "GET" && url === "/v1/models") {
        const models = await listModels(runtime)
        writeJson(response, 200, {
          object: "list",
          data: models.map((model) => ({
            id: model.id,
            object: "model",
            created: model.createdAt
              ? Math.floor(new Date(model.createdAt).getTime() / 1000)
              : unixSeconds(),
            owned_by: model.providerId
          }))
        })
        return
      }

      if (method === "POST" && url === "/v1/chat/completions") {
        const body = await readJsonBody<OpenAIChatCompletionRequest>(request)
        if (
          !body.model ||
          !Array.isArray(body.messages) ||
          body.messages.length === 0
        ) {
          writeJson(response, 400, {
            error: {
              message: "model and messages are required"
            }
          })
          return
        }

        const completionId = createCompletionId()
        const created = unixSeconds()
        const stream = Boolean(body.stream)

        const provider = await runtime.resolveProviderForModel(
          body.model,
          body.provider
        )

        const chatRequest: ChatRequest = {
          model: body.model,
          messages: body.messages,
          stream,
          temperature: body.temperature,
          top_p: body.top_p,
          max_tokens: body.max_tokens
        }

        if (stream) {
          response.statusCode = 200
          response.setHeader("Content-Type", "text/event-stream")
          response.setHeader("Cache-Control", "no-cache")
          response.setHeader("Connection", "keep-alive")

          await provider.streamChat(chatRequest, {
            onChunk: (chunk) => {
              if (chunk.delta) {
                const payload = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model: body.model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: chunk.delta },
                      finish_reason: null
                    }
                  ]
                }
                response.write(`data: ${JSON.stringify(payload)}\n\n`)
              }

              if (chunk.done) {
                const payload = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created,
                  model: body.model,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: "stop"
                    }
                  ]
                }
                response.write(`data: ${JSON.stringify(payload)}\n\n`)
                response.write("data: [DONE]\n\n")
                response.end()
              }
            }
          })
          return
        }

        let text = ""
        await provider.streamChat(chatRequest, {
          onChunk: (chunk) => {
            if (chunk.delta) {
              text += chunk.delta
            }
          }
        })

        writeJson(response, 200, {
          id: completionId,
          object: "chat.completion",
          created,
          model: body.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: text
              }
            }
          ]
        })
        return
      }

      writeJson(response, 404, {
        error: { message: "Not found" }
      })
    } catch (error) {
      writeJson(response, toStatusCode(error), {
        error: {
          message: error instanceof Error ? error.message : String(error)
        }
      })
    }
  })

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve())
  })

  const address = server.address() as AddressInfo
  return {
    server,
    url: `http://${address.address}:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}
