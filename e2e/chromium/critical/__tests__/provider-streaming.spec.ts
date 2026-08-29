import type { IncomingMessage, ServerResponse } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { expect, test } from "../../fixtures/extension"
import {
  openPersistenceVerifyPage,
  type VerifyCall,
  waitForOpfsMarker
} from "../../fixtures/persistence"

const PROVIDERS = {
  ollama: { id: "ollama", basePath: "/custom/ollama" },
  lmStudio: { id: "lm studio", basePath: "/custom/lm-studio/v1" },
  llamaCpp: { id: "llamacpp", basePath: "/custom/llama-cpp/v1" }
} as const

interface ProviderRequest {
  body: Record<string, unknown>
  path: string
}

const readBody = (request: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {})
      } catch (error) {
        reject(error)
      }
    })
  })

const latestUserText = (body: Record<string, unknown>): string => {
  const messages = Array.isArray(body.messages) ? body.messages : []
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== "object") continue
    if (Reflect.get(message, "role") !== "user") continue
    const content = Reflect.get(message, "content")
    if (typeof content === "string") return content
  }
  return ""
}

const sendJson = (response: ServerResponse, payload: unknown): void => {
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(payload))
}

const handleModelRequest = (
  path: string,
  response: ServerResponse
): boolean => {
  if (path.endsWith("/api/tags")) {
    sendJson(response, {
      models: [
        {
          name: "verify-model",
          model: "verify-model",
          modified_at: new Date(0).toISOString(),
          size: 1,
          digest: "verify",
          details: { family: "verify", families: ["verify"] }
        }
      ]
    })
    return true
  }
  if (path.endsWith("/api/show")) {
    sendJson(response, {
      capabilities: ["completion"],
      details: { family: "verify" }
    })
    return true
  }
  if (path.endsWith("/api/v0/models")) {
    sendJson(response, {
      data: [
        {
          id: "verify-model",
          type: "llm",
          arch: "verify",
          capabilities: []
        }
      ]
    })
    return true
  }
  if (path.endsWith("/v1/models")) {
    sendJson(response, {
      data: [{ id: "verify-model", meta: { n_params: 1_000_000_000 } }]
    })
    return true
  }
  return false
}

const handleHttpFailure = (
  prompt: string,
  response: ServerResponse,
  payload: unknown
): boolean => {
  if (!prompt.includes("http failure")) return false
  response.statusCode = 503
  sendJson(response, payload)
  return true
}

const handleOllamaChat = async (
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  requests: ProviderRequest[]
): Promise<void> => {
  const body = await readBody(request)
  requests.push({ body, path })
  const prompt = latestUserText(body)
  if (handleHttpFailure(prompt, response, { error: "mock unavailable" })) return

  response.setHeader("Content-Type", "application/x-ndjson")
  response.write(
    `${JSON.stringify({ message: { content: "custom " }, done: false })}\n`
  )
  response.end(
    `${JSON.stringify({ message: { content: "ollama" }, done: false })}\n${JSON.stringify({ message: { content: "" }, done: true })}\n`
  )
}

const sendFragmentedSse = async (response: ServerResponse): Promise<void> => {
  response.write("data: {malformed-json}\n\n")
  response.write('data: {"choices":[{"delta":{"content":"frag')
  await new Promise<void>((resolve) => setImmediate(resolve))
  response.write('mented "},"finish_reason":null}]}\n\n')
  response.write('data: {"choices":[{"delta":{"content":"stream"}')
  await new Promise<void>((resolve) => setImmediate(resolve))
  response.end(',"finish_reason":"stop"}]}')
}

const handleOpenAiChat = async (
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  requests: ProviderRequest[]
): Promise<void> => {
  const body = await readBody(request)
  requests.push({ body, path })
  const prompt = latestUserText(body)
  if (
    handleHttpFailure(prompt, response, {
      error: { message: "mock unavailable" }
    })
  ) {
    return
  }

  response.setHeader("Content-Type", "text/event-stream")
  if (prompt.includes("fragmented sse")) {
    await sendFragmentedSse(response)
    return
  }

  const providerText = path.includes("lm-studio") ? "lm studio" : "llama.cpp"
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content: "custom " }, finish_reason: null }] })}\n\n`
  )
  response.end(
    `data: ${JSON.stringify({ choices: [{ delta: { content: providerText }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`
  )
}

const handleMockRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  requests: ProviderRequest[]
): Promise<void> => {
  response.setHeader("Access-Control-Allow-Origin", "*")
  response.setHeader("Access-Control-Allow-Headers", "*")
  if (request.method === "OPTIONS") {
    response.statusCode = 204
    response.end()
    return
  }

  const path = request.url ?? ""
  if (handleModelRequest(path, response)) return
  if (path.endsWith("/api/chat")) {
    await handleOllamaChat(request, response, path, requests)
    return
  }
  if (path.endsWith("/chat/completions")) {
    await handleOpenAiChat(request, response, path, requests)
    return
  }

  response.statusCode = 404
  sendJson(response, { error: "not found" })
}

const startMockProvider = async () => {
  const requests: ProviderRequest[] = []
  const server = createServer((request, response) =>
    handleMockRequest(request, response, requests)
  )

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`
  let closed = false
  return {
    baseUrl: (path: string) => `${origin}${path}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        if (closed) {
          resolve()
          return
        }
        closed = true
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}

const startTurn = (
  call: VerifyCall,
  turnId: string,
  prompt: string,
  providerId: string
) => call("startDurableTurn", turnId, prompt, providerId)

test("@critical built-in providers stream through fully custom base URLs", async ({
  extension
}) => {
  test.setTimeout(120_000)
  const mock = await startMockProvider()
  try {
    const { page, call } = await openPersistenceVerifyPage(extension)
    await waitForOpfsMarker(call)

    const cases = [
      { ...PROVIDERS.ollama, expected: "custom ollama" },
      { ...PROVIDERS.lmStudio, expected: "custom lm studio" },
      { ...PROVIDERS.llamaCpp, expected: "custom llama.cpp" }
    ]
    for (const provider of cases) {
      await call(
        "configureFakeProvider",
        provider.id,
        mock.baseUrl(provider.basePath)
      )
      const assistantMessageId = (await startTurn(
        call,
        `custom-url-${provider.id}`,
        `${provider.id} custom-url stream`,
        provider.id
      )) as number
      await expect
        .poll(
          () =>
            call(
              "durableTurnResult",
              `custom-url-${provider.id}`,
              assistantMessageId
            ),
          { timeout: 30_000 }
        )
        .toEqual({
          status: "completed",
          content: provider.expected,
          done: true
        })
    }

    expect(mock.requests.map(({ path }) => path)).toEqual([
      "/custom/ollama/api/chat",
      "/custom/lm-studio/v1/chat/completions",
      "/custom/llama-cpp/v1/chat/completions"
    ])
    await page.close()
  } finally {
    await mock.close()
  }
})

test("@critical partial and malformed SSE still completes", async ({
  extension
}) => {
  const mock = await startMockProvider()
  try {
    const { page, call } = await openPersistenceVerifyPage(extension)
    await waitForOpfsMarker(call)
    await call(
      "configureFakeProvider",
      PROVIDERS.llamaCpp.id,
      mock.baseUrl(PROVIDERS.llamaCpp.basePath)
    )

    const assistantMessageId = (await startTurn(
      call,
      "fragmented-sse",
      "fragmented sse",
      PROVIDERS.llamaCpp.id
    )) as number
    await expect
      .poll(
        () => call("durableTurnResult", "fragmented-sse", assistantMessageId),
        { timeout: 30_000 }
      )
      .toEqual({
        status: "completed",
        content: "fragmented stream",
        done: true
      })
    await page.close()
  } finally {
    await mock.close()
  }
})

test("@critical HTTP and connection failures reach the durable result", async ({
  extension
}) => {
  const mock = await startMockProvider()
  try {
    const { page, call } = await openPersistenceVerifyPage(extension)
    await waitForOpfsMarker(call)
    await call(
      "configureFakeProvider",
      PROVIDERS.lmStudio.id,
      mock.baseUrl(PROVIDERS.lmStudio.basePath)
    )
    const httpAssistantId = (await startTurn(
      call,
      "http-failure",
      "http failure",
      PROVIDERS.lmStudio.id
    )) as number
    await expect
      .poll(() => call("durableTurnResult", "http-failure", httpAssistantId), {
        timeout: 30_000
      })
      .toMatchObject({ status: "failed", done: true })

    const closedBaseUrl = mock.baseUrl("/closed-provider/v1")
    await mock.close()
    await call("configureFakeProvider", PROVIDERS.llamaCpp.id, closedBaseUrl)
    const connectionAssistantId = (await startTurn(
      call,
      "connection-failure",
      "connection failure",
      PROVIDERS.llamaCpp.id
    )) as number
    await expect
      .poll(
        () =>
          call(
            "durableTurnResult",
            "connection-failure",
            connectionAssistantId
          ),
        { timeout: 30_000 }
      )
      .toMatchObject({ status: "failed", done: true })
    await page.close()
  } finally {
    await mock.close()
  }
})
