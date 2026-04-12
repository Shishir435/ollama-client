import { mkdtemp } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ConfigStore } from "../config"
import { RuntimeContext } from "../runtime"
import { startOpenAIServer } from "../server/openai"

const startMockProvider = async () => {
  const server = createServer((request, response) => {
    const method = request.method || "GET"
    const url = request.url || "/"

    if (method === "GET" && url === "/api/tags") {
      response.setHeader("Content-Type", "application/json")
      response.end(
        JSON.stringify({
          models: [{ name: "demo-model", model: "demo-model", size: 123 }]
        })
      )
      return
    }

    if (method === "POST" && url === "/api/chat") {
      response.setHeader("Content-Type", "application/x-ndjson")
      response.write(
        `${JSON.stringify({
          message: { content: "Hello" },
          done: false
        })}\n`
      )
      response.write(
        `${JSON.stringify({
          message: { content: " World" },
          done: false
        })}\n`
      )
      response.write(`${JSON.stringify({ done: true })}\n`)
      response.end()
      return
    }

    response.statusCode = 404
    response.end()
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve mock server address")
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

describe("OpenAI-compatible server", () => {
  it("serves /v1/models and /v1/chat/completions", async () => {
    const provider = await startMockProvider()
    const configDir = await mkdtemp(join(tmpdir(), "olc-core-server-"))
    const store = new ConfigStore(join(configDir, "config.json"))
    const runtime = new RuntimeContext(store)
    const config = await runtime.getConfig()
    config.providers = config.providers.map((item) =>
      item.id === "ollama" ? { ...item, baseUrl: provider.url } : item
    )
    await runtime.saveConfig(config)

    const server = await startOpenAIServer({
      host: "127.0.0.1",
      port: 0,
      runtime
    })

    const modelsResponse = await fetch(`${server.url}/v1/models`)
    expect(modelsResponse.status).toBe(200)
    const modelsBody = (await modelsResponse.json()) as {
      data: Array<{ id: string }>
    }
    expect(modelsBody.data.some((item) => item.id === "demo-model")).toBe(true)

    const completionResponse = await fetch(
      `${server.url}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "demo-model",
          messages: [{ role: "user", content: "Ping" }]
        })
      }
    )
    expect(completionResponse.status).toBe(200)
    const completionBody = (await completionResponse.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    expect(completionBody.choices[0]?.message.content).toBe("Hello World")

    const streamResponse = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "demo-model",
        stream: true,
        messages: [{ role: "user", content: "Ping" }]
      })
    })
    expect(streamResponse.status).toBe(200)
    const streamBody = await streamResponse.text()
    expect(streamBody.includes("data: [DONE]")).toBe(true)

    await server.close()
    await provider.close()
  })
})
