import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { Page } from "@playwright/test"
import { expect, test, waitForProviderDefaults } from "../../fixtures/extension"

/**
 * First run and failure recovery, through the real side panel.
 *
 * A working local Ollama should be one click from a first answer; a server
 * that is running but will not talk to the extension should say so, with the
 * fix, instead of "start it"; and a response that dies part-way should keep
 * what it wrote and offer both a retry and a way to carry on.
 */

const MODEL = "fixture-chat"
const FIRST_RUN_PROMPT =
  "Say hello in one sentence and tell me which model you are."
const CONTINUE_PROMPT = "Continue from where you stopped."

interface ChatBody {
  messages?: { role?: string; content?: string }[]
}

const line = (value: unknown) => `${JSON.stringify(value)}\n`

const chunk = (content: string, done = false) =>
  line({
    model: MODEL,
    message: { role: "assistant", content },
    done
  })

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const part of request) chunks.push(Buffer.from(part))
  return Buffer.concat(chunks).toString()
}

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const shutdown = async (server: Server): Promise<void> => {
  /** The extension keeps provider connections alive, and `close` waits for them. */
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

const tags = () =>
  JSON.stringify({
    models: [{ name: MODEL, model: MODEL, details: { family: "x" } }]
  })

/** Point the fresh profile's Ollama at a fixture and open the panel on it. */
const openPanelOn = async (
  extension: Parameters<Parameters<typeof test>[2]>[0]["extension"],
  origin: string,
  options: { selectModel: boolean }
): Promise<Page> => {
  const panel = await extension.context.newPage()
  await panel.goto(`chrome-extension://${extension.extensionId}/sidepanel.html`)
  await waitForProviderDefaults(panel)
  await panel.evaluate(
    async ({ origin, model, selectModel }) => {
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
        ...(selectModel
          ? {
              "provider-selected-model-ref": JSON.stringify({
                providerId: "ollama",
                modelId: model
              })
            }
          : {})
      })
    },
    { origin, model: MODEL, selectModel: options.selectModel }
  )
  await panel.reload()
  return panel
}

test("@critical a working Ollama finishes first-run setup in one click", async ({
  extension
}) => {
  const chats: ChatBody[] = []
  const server = createServer(async (request, response) => {
    const body = await readBody(request)
    response.setHeader("Content-Type", "application/json")
    if (request.url === "/api/tags") return void response.end(tags())
    if (request.url === "/api/show") {
      return void response.end(JSON.stringify({ capabilities: ["completion"] }))
    }
    if (request.url === "/api/chat") {
      chats.push(JSON.parse(body) as ChatBody)
      return void response.end(
        chunk("Hello, I am the fixture model.") + chunk("", true)
      )
    }
    response.end("{}")
  })
  const origin = await listen(server)

  try {
    const panel = await openPanelOn(extension, origin, { selectModel: false })

    const dialog = panel.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toContainText("already running")
    // One screen: no step counter, because nothing else is going to be shown.
    await expect(dialog).not.toContainText(/Step \d+ of/)
    await dialog.getByRole("button", { name: `Start with ${MODEL}` }).click()

    await expect(panel.getByText("Hello, I am the fixture model.")).toBeVisible(
      { timeout: 30_000 }
    )
    expect(chats[0]?.messages?.at(-1)?.content).toContain(FIRST_RUN_PROMPT)
    await expect(panel.getByRole("dialog")).toHaveCount(0)

    // Finished, so it does not come back on the next open.
    await panel.reload()
    await expect(panel.locator("#chat-input-textarea")).toBeVisible()
    await expect(panel.getByRole("dialog")).toHaveCount(0)
  } finally {
    await shutdown(server)
  }
})

test("@critical closing setup without skipping is remembered", async ({
  extension
}) => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json")
    response.end(request.url === "/api/tags" ? tags() : "{}")
  })
  const origin = await listen(server)

  try {
    const panel = await openPanelOn(extension, origin, { selectModel: true })
    await expect(panel.getByRole("dialog")).toBeVisible({ timeout: 15_000 })

    await panel.keyboard.press("Escape")
    await expect(panel.getByRole("dialog")).toHaveCount(0)

    await panel.reload()
    await expect(panel.locator("#chat-input-textarea")).toBeVisible()
    await expect(panel.getByRole("dialog")).toHaveCount(0)
  } finally {
    await shutdown(server)
  }
})

test("@critical Chat Sessions stays open during side panel startup", async ({
  extension
}) => {
  const worker =
    extension.context.serviceWorkers()[0] ??
    (await extension.context.waitForEvent("serviceworker"))
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      "onboarding-state-v2": JSON.stringify({ version: 2, stage: "complete" })
    })
    await chrome.storage.sync.set({
      "agent-announcement-dismissed-v1": JSON.stringify(true)
    })
  })

  const panel = await extension.context.newPage()
  await panel.goto(
    `chrome-extension://${extension.extensionId}/sidepanel.html`,
    {
      waitUntil: "commit"
    }
  )
  await panel.getByRole("button", { name: "Chat Sessions" }).click()
  const sheet = panel.getByRole("dialog", { name: "Chat Sessions" })
  await expect(sheet).toBeVisible()
  await panel.waitForTimeout(2_000)
  await expect(sheet).toBeVisible()
})

test("@critical a server that answers but refuses the extension gets the origins fix", async ({
  extension
}) => {
  /**
   * Something is listening — it answers the root — but every API request is
   * reset, as a firewall or a proxy in front of Ollama would. A stopped
   * server could not answer the root, which is how the two are told apart.
   */
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.end("Ollama is running")
      return
    }
    request.socket.destroy()
  })
  const origin = await listen(server)

  try {
    const panel = await openPanelOn(extension, origin, { selectModel: false })
    await panel
      .getByRole("button", { name: "Skip for now", exact: true })
      .click({ timeout: 15_000 })

    const card = panel.getByRole("status")
    await expect(card).toContainText("refused this extension", {
      timeout: 20_000
    })
    await expect(card).toContainText("OLLAMA_ORIGINS")
    await expect(card).toContainText("olc")
    await expect(card.getByRole("button", { name: "Recheck" })).toBeVisible()
  } finally {
    await shutdown(server)
  }
})

test("@critical a stopped server is not blamed on the extension's origin", async ({
  extension
}) => {
  const closed = createServer()
  const origin = await listen(closed)
  await shutdown(closed)

  const panel = await openPanelOn(extension, origin, { selectModel: false })
  await panel
    .getByRole("button", { name: "Skip for now", exact: true })
    .click({ timeout: 15_000 })

  const card = panel.getByRole("status")
  await expect(card).toContainText("Can't reach", { timeout: 20_000 })
  await expect(card).not.toContainText("OLLAMA_ORIGINS")
  await expect(card.getByRole("button", { name: "Recheck" })).toBeVisible()
})

/**
 * A fixture that dies part-way through its first answer — the socket is cut
 * after some text — and answers every later request in full.
 */
const startDroppingServer = async () => {
  const chats: ChatBody[] = []
  const server = createServer(async (request, response) => {
    const body = await readBody(request)
    response.setHeader("Content-Type", "application/json")
    if (request.url === "/api/tags") return void response.end(tags())
    if (request.url === "/api/show") {
      return void response.end(JSON.stringify({ capabilities: ["completion"] }))
    }
    if (request.url === "/api/chat") {
      chats.push(JSON.parse(body) as ChatBody)
      if (chats.length === 1) {
        response.setHeader("Content-Type", "application/x-ndjson")
        response.write(chunk("The first half of the answer"))
        await new Promise((resolve) => setTimeout(resolve, 150))
        request.socket.destroy()
        return
      }
      response.setHeader("Content-Type", "application/x-ndjson")
      return void response.end(
        chunk(" and then the rest of it.") + chunk("", true)
      )
    }
    response.end("{}")
  })
  return { server, chats, origin: await listen(server) }
}

const askAndFail = async (panel: Page) => {
  await panel
    .getByRole("button", { name: "Skip for now", exact: true })
    .click({ timeout: 15_000 })
    .catch(() => {})
  const composer = panel.locator("#chat-input-textarea")
  await composer.fill("Tell me something long.")
  await composer.press("Enter")
  await expect(panel.getByText("The first half of the answer")).toBeVisible({
    timeout: 30_000
  })
}

test("@critical a response that dies part-way keeps its text and offers Retry and Continue", async ({
  extension
}) => {
  const { server, chats, origin } = await startDroppingServer()

  try {
    const panel = await openPanelOn(extension, origin, { selectModel: true })
    await askAndFail(panel)

    const failure = panel.getByRole("alert")
    await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible({
      timeout: 30_000
    })
    const cont = failure.getByRole("button", { name: "Continue", exact: true })
    await expect(cont).toBeVisible()
    await expect(panel.getByText("The first half of the answer")).toBeVisible()

    await cont.click()

    await expect(panel.getByText(CONTINUE_PROMPT).first()).toBeVisible({
      timeout: 30_000
    })
    await expect(panel.getByText("and then the rest of it.")).toBeVisible({
      timeout: 30_000
    })
    /** The model is told what it had already written, then asked to go on. */
    const sent = chats.at(-1)?.messages ?? []
    expect(sent.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining(CONTINUE_PROMPT)
    })
    expect(
      sent.some(
        (message) =>
          message.role === "assistant" &&
          message.content?.includes("The first half of the answer")
      )
    ).toBe(true)
  } finally {
    await shutdown(server)
  }
})

test("@critical Retry asks the failed turn again", async ({ extension }) => {
  const { server, chats, origin } = await startDroppingServer()

  try {
    const panel = await openPanelOn(extension, origin, { selectModel: true })
    await askAndFail(panel)

    await panel
      .getByRole("alert")
      .getByRole("button", { name: "Retry" })
      .click({ timeout: 30_000 })

    await expect(panel.getByText("and then the rest of it.")).toBeVisible({
      timeout: 30_000
    })
    expect(chats).toHaveLength(2)
    expect(chats[1].messages?.at(-1)?.content).toContain(
      "Tell me something long."
    )
  } finally {
    await shutdown(server)
  }
})
