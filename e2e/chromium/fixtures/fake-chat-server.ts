import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import type { Page } from "@playwright/test"
import { waitForProviderDefaults } from "./extension"

export interface ChatBody {
  messages?: { role?: string; content?: string }[]
  tools?: { function?: { name?: string } }[]
}

export interface FakeChatServer {
  origin: string
  /** Every `/api/chat` request body the extension sent, in order. */
  chats: ChatBody[]
  close: () => Promise<void>
}

const PDF_DIR = resolve(__dirname, "pdf")

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

const line = (value: unknown) => `${JSON.stringify(value)}\n`

/**
 * A local origin that is both an Ollama-shaped chat provider and a small web
 * site: `/api/*` answers the model, `/files/<name>.pdf` serves the committed PDF
 * fixtures, and anything else serves `pages[path]`. The scripted model replies
 * with a fixed sentence, so a test asserts on what the extension *sent*.
 */
export const startFakeChatServer = async ({
  model,
  reply = "Noted.",
  pages = {}
}: {
  model: string
  reply?: string
  pages?: Record<string, string>
}): Promise<FakeChatServer> => {
  const chats: ChatBody[] = []
  const server: Server = createServer(async (request, response) => {
    const body = await readBody(request)
    const path = (request.url ?? "/").split("?")[0]
    if (path.startsWith("/api/")) {
      response.setHeader("Content-Type", "application/json")
      if (path === "/api/tags") {
        response.end(
          JSON.stringify({
            models: [{ name: model, model, details: { family: "x" } }]
          })
        )
      } else if (path === "/api/show") {
        response.end(JSON.stringify({ capabilities: ["completion"] }))
      } else if (path === "/api/chat") {
        chats.push(JSON.parse(body) as ChatBody)
        response.end(
          line({
            model,
            message: { role: "assistant", content: reply },
            done: false
          }) +
            line({
              model,
              message: { role: "assistant", content: "" },
              done: true
            })
        )
      } else {
        response.end("{}")
      }
      return
    }
    const pdf = /^\/files\/([\w-]+\.pdf)$/.exec(path)
    if (pdf) {
      response.setHeader("Content-Type", "application/pdf")
      response.end(readFileSync(resolve(PDF_DIR, pdf[1])))
      return
    }
    const page = pages[path]
    response.statusCode = page === undefined ? 404 : 200
    response.setHeader("Content-Type", "text/html")
    response.end(page ?? "<!doctype html><title>Not found</title>")
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    chats,
    close: async () => {
      /** The extension keeps provider connections alive, and `close` waits for them. */
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    }
  }
}

/** Points the side panel at the fake provider and reloads it ready to chat. */
export const openConfiguredPanel = async (
  panel: Page,
  extensionId: string,
  { origin, model }: { origin: string; model: string }
): Promise<void> => {
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await waitForProviderDefaults(panel)
  await panel.evaluate(
    async ({ origin, model }) => {
      await chrome.storage.sync.set({
        /** The agent announcement would otherwise cover the composer. */
        "agent-announcement-dismissed-v1": JSON.stringify(true),
        llm_providers_config_v1: JSON.stringify([
          {
            id: "ollama",
            type: "ollama",
            name: "Fixture Ollama",
            enabled: true,
            baseUrl: origin
          }
        ]),
        "provider-selected-model-ref": JSON.stringify({
          providerId: "ollama",
          modelId: model
        })
      })
    },
    { origin, model }
  )
  await panel.reload()
  await panel
    .getByRole("button", { name: "Skip for now", exact: true })
    .click({ timeout: 10_000 })
    .catch(() => {})
}

/** The text of the user message in the most recent chat request. */
export const lastUserContent = (chats: ChatBody[]): string =>
  [...(chats.at(-1)?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user")?.content ?? ""

/** Everything the model was shown in the most recent chat request. */
export const lastPromptText = (chats: ChatBody[]): string =>
  (chats.at(-1)?.messages ?? [])
    .map((message) => message.content ?? "")
    .join("\n")
