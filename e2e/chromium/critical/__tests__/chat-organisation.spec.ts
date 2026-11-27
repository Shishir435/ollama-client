import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { Page } from "@playwright/test"
import {
  type ExtensionSession,
  expect,
  test,
  waitForProviderDefaults
} from "../../fixtures/extension"

/**
 * Organising chats: renaming, finding a message by its words, and choosing
 * which MCP connectors a chat may use. The model is a scripted Ollama server,
 * so what is asserted is what the extension sends and stores, not what a model
 * says.
 */

const MODEL = "fixture-chat"
const REPLY = "Noted."

interface ChatBody {
  messages?: { role?: string; content?: string }[]
  tools?: { function?: { name?: string } }[]
}

const toolNames = (body: ChatBody | undefined): string[] =>
  (body?.tools ?? []).map((tool) => tool.function?.name ?? "")

const startModelServer = async () => {
  const chats: ChatBody[] = []
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    const path = request.url ?? "/"
    response.setHeader("Content-Type", "application/json")
    if (path === "/api/tags") {
      response.end(
        JSON.stringify({
          models: [{ name: MODEL, model: MODEL, details: { family: "x" } }]
        })
      )
      return
    }
    if (path === "/api/show") {
      response.end(JSON.stringify({ capabilities: ["completion", "tools"] }))
      return
    }
    if (path === "/api/chat") {
      chats.push(JSON.parse(body) as ChatBody)
      const line = (value: unknown) => `${JSON.stringify(value)}\n`
      response.end(
        line({
          model: MODEL,
          message: { role: "assistant", content: REPLY },
          done: false
        }) +
          line({
            model: MODEL,
            message: { role: "assistant", content: "" },
            done: true
          })
      )
      return
    }
    response.end("{}")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    chats,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      /** The extension keeps provider connections alive; `close` waits for them. */
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

const connector = (id: string, name: string, tool: string) => ({
  id,
  type: "mcp-http",
  name,
  url: `http://127.0.0.1:9/mcp/${id}`,
  enabled: true,
  auth: { kind: "none" },
  status: "ok",
  tools: [
    {
      name: tool,
      description: `${name} tool`,
      inputSchema: { type: "object", properties: {} },
      enabled: true
    }
  ]
})

const reload = async (panel: Page) => {
  await panel.reload()
  await panel.locator("#chat-input-textarea").waitFor()
}

const openPanel = async (
  extension: ExtensionSession,
  origin: string,
  extraStorage: Record<string, unknown> = {}
): Promise<Page> => {
  const panel = await extension.context.newPage()
  await panel.goto(`chrome-extension://${extension.extensionId}/sidepanel.html`)
  await waitForProviderDefaults(panel)
  await panel.evaluate(
    async ({ origin, model, extra }) => {
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
      await chrome.storage.local.set(
        Object.fromEntries(
          Object.entries(extra).map(([key, value]) => [
            key,
            JSON.stringify(value)
          ])
        )
      )
    },
    { origin, model: MODEL, extra: extraStorage }
  )
  await reload(panel)
  await panel
    .getByRole("button", { name: "Skip for now", exact: true })
    .click({ timeout: 10_000 })
    .catch(() => {})
  return panel
}

const send = async (panel: Page, text: string, expectedReplies: number) => {
  const composer = panel.locator("#chat-input-textarea")
  await composer.fill(text)
  await composer.press("Enter")
  await expect(panel.getByText(REPLY)).toHaveCount(expectedReplies, {
    timeout: 30_000
  })
}

const openSessions = async (panel: Page) => {
  await panel.getByRole("button", { name: "Chat Sessions" }).click()
  return panel.getByRole("searchbox")
}

test("@critical a chat renames in place from its row and its header, and keeps the name", async ({
  extension
}) => {
  const model = await startModelServer()
  try {
    const panel = await openPanel(extension, model.origin)
    await send(panel, "plan the lisbon trip", 1)

    /** The first message names the chat until the user does. */
    const header = panel.getByTitle("plan the lisbon trip")
    await expect(header).toBeVisible()

    await openSessions(panel)
    await panel
      .getByRole("button", { name: /^More actions for plan the lisbon trip/ })
      .click()
    await panel.getByRole("menuitem", { name: "Rename" }).click()
    const rowInput = panel.getByRole("textbox", { name: "Chat title" })
    await expect(rowInput).toBeFocused()
    await rowInput.fill("Escape me")
    await rowInput.press("Escape")
    await expect(panel.getByText("plan the lisbon trip").first()).toBeVisible()

    await panel
      .getByRole("button", { name: /^More actions for plan the lisbon trip/ })
      .click()
    await panel.getByRole("menuitem", { name: "Rename" }).click()
    await panel.getByRole("textbox", { name: "Chat title" }).fill("  Lisbon  ")
    await panel.getByRole("textbox", { name: "Chat title" }).press("Enter")
    await expect(panel.getByTitle("Lisbon")).toBeVisible()
    await panel.keyboard.press("Escape")

    /** A later message never retitles a chat the user named. */
    await send(panel, "and what about porto", 2)
    await expect(panel.getByTitle("Lisbon")).toBeVisible()

    await reload(panel)
    await expect(panel.getByTitle("Lisbon")).toBeVisible({ timeout: 15_000 })

    await panel.getByRole("button", { name: "Rename chat" }).click()
    const headerInput = panel.getByRole("textbox", { name: "Chat title" })
    await headerInput.fill("Portugal")
    await headerInput.press("Enter")
    await expect(panel.getByTitle("Portugal")).toBeVisible()
    await panel.getByRole("button", { name: "Rename chat" }).click()
    await panel.getByRole("textbox", { name: "Chat title" }).fill("   ")
    await panel.getByRole("textbox", { name: "Chat title" }).press("Enter")
    await expect(panel.getByTitle("Portugal")).toBeVisible()

    await reload(panel)
    await expect(panel.getByTitle("Portugal")).toBeVisible({ timeout: 15_000 })
  } finally {
    await model.close()
  }
})

test("@critical sidebar search finds a message by its words and opens that chat", async ({
  extension
}) => {
  const model = await startModelServer()
  try {
    const panel = await openPanel(extension, model.origin)
    await send(panel, "the zanzibar invoice is overdue", 1)

    await openSessions(panel)
    await panel.getByRole("button", { name: "New chat" }).click()
    /** Creating a chat leaves the sidebar open, and it is modal. */
    await panel.keyboard.press("Escape")
    await send(panel, "something unrelated entirely", 1)

    const search = await openSessions(panel)
    await search.fill("zanzib")
    const hit = panel.getByRole("button", {
      name: /Open You message in the zanzibar invoice is overdue/
    })
    await expect(hit).toBeVisible({ timeout: 10_000 })
    await expect(hit.locator("mark")).toHaveText("zanzibar")
    /** Only the chat that holds the words is offered. */
    await expect(
      panel.getByRole("button", { name: /Open .* message in something/ })
    ).toHaveCount(0)

    await hit.click()
    await expect(
      panel.getByText("the zanzibar invoice is overdue").first()
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      panel.getByTitle("the zanzibar invoice is overdue")
    ).toBeVisible()
  } finally {
    await model.close()
  }
})

test("@critical a connector switched off for a chat is not offered to the model, and the choice persists", async ({
  extension
}) => {
  const model = await startModelServer()
  try {
    const panel = await openPanel(extension, model.origin, {
      "mcp-connectors-v1": [
        connector("c_mail", "Mail", "send"),
        connector("c_notes", "Notes", "append")
      ]
    })

    /** Every enabled connector is on for a chat that never opened the picker. */
    await send(panel, "first question", 1)
    expect(toolNames(model.chats[0])).toEqual(
      expect.arrayContaining(["mail_send", "notes_append"])
    )

    await panel.getByRole("button", { name: /^Context/ }).click()
    const mail = panel.getByRole("button", { name: "Mail", exact: true })
    const notes = panel.getByRole("button", { name: "Notes", exact: true })
    await expect(mail).toHaveAttribute("aria-pressed", "true")
    await mail.click()
    await expect(mail).toHaveAttribute("aria-pressed", "false")
    await expect(notes).toHaveAttribute("aria-pressed", "true")
    await panel.keyboard.press("Escape")
    await expect(panel.getByRole("dialog")).toHaveCount(0)

    await send(panel, "second question", 2)
    const second = toolNames(model.chats.at(-1))
    expect(second).not.toContain("mail_send")
    expect(second).toContain("notes_append")

    /** The choice belongs to the chat and survives a reload. */
    await reload(panel)
    await panel.getByRole("button", { name: /^Context/ }).click()
    await expect(
      panel.getByRole("button", { name: "Mail", exact: true })
    ).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 })
    await panel.keyboard.press("Escape")
    await expect(panel.getByRole("dialog")).toHaveCount(0)

    /** A new chat starts with everything on again. */
    await openSessions(panel)
    await panel.getByRole("button", { name: "New chat" }).click()
    await panel.keyboard.press("Escape")
    await expect(panel.getByRole("dialog")).toHaveCount(0)
    await send(panel, "fresh chat question", 1)
    expect(toolNames(model.chats.at(-1))).toEqual(
      expect.arrayContaining(["mail_send", "notes_append"])
    )
  } finally {
    await model.close()
  }
})

test("@critical the connector picker is absent when no connector is enabled", async ({
  extension
}) => {
  const model = await startModelServer()
  try {
    const panel = await openPanel(extension, model.origin)
    await send(panel, "hello", 1)
    await panel.getByRole("button", { name: /^Context/ }).click()
    await expect(panel.getByText("Chat instructions")).toBeVisible()
    await expect(
      panel.getByRole("heading", { name: "Connectors" })
    ).toHaveCount(0)
  } finally {
    await model.close()
  }
})
