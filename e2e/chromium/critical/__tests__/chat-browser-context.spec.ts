import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { expect, test } from "../../fixtures/extension"

/**
 * A chat model in the side panel is told where it is and what "this" means.
 *
 * Asked "what are we doing in this pr?" with the pull request open beside
 * the panel, a hosted model answered that its workspace was empty and asked
 * for a diff: nothing in the prompt said it lived in a browser, and the page
 * was one `current_tab` call away. The scripted model here cannot decide to
 * call the tool, so this asserts the two things that make a real one do it —
 * the prompt carries the browser context and the tab's metadata — and that
 * the call, when made, reads the panel's own tab.
 */

const MODEL = "fixture-chat"
const PAGE_TITLE = "Start runs from chat by Shishir · Pull Request #421"
const PAGE_TEXT = "This pull request starts browser runs from an ordinary chat."

const PR_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>${PAGE_TITLE}</title></head>
<body><main><h1>${PAGE_TITLE}</h1><p>${PAGE_TEXT}</p></main></body></html>`

interface ChatBody {
  messages?: { role?: string; content?: string }[]
  tools?: { function?: { name?: string } }[]
}

test("@critical chat names the panel's tab and reads it through current_tab", async ({
  extension
}) => {
  const chats: ChatBody[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString()
    const path = request.url ?? "/"
    if (path.startsWith("/api/")) {
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
        const parsed = JSON.parse(body) as ChatBody
        chats.push(parsed)
        const answered = parsed.messages?.some(
          (message) => message.role === "tool"
        )
        const line = (value: unknown) => `${JSON.stringify(value)}\n`
        response.end(
          answered
            ? line({
                model: MODEL,
                message: {
                  role: "assistant",
                  content: "It starts runs from chat."
                },
                done: false
              }) +
                line({
                  model: MODEL,
                  message: { role: "assistant", content: "" },
                  done: true
                })
            : line({
                model: MODEL,
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    { function: { name: "current_tab", arguments: {} } }
                  ]
                },
                done: true
              })
        )
        return
      }
      response.end("{}")
      return
    }
    response.setHeader("Content-Type", "text/html")
    response.end(PR_PAGE)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))

  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const panel = await extension.context.newPage()
    await panel.goto(
      `chrome-extension://${extension.extensionId}/sidepanel.html`
    )
    await panel.evaluate(
      async ({ origin, model }) => {
        await chrome.storage.sync.set({
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
      { origin, model: MODEL }
    )
    await panel.reload()
    const page = await extension.context.newPage()
    await page.goto(`${origin}/o/r/pull/421?tab=files#diff`)
    await page.bringToFront()

    await panel
      .getByRole("button", { name: "Skip for now", exact: true })
      .click({ timeout: 10_000 })
      .catch(() => {})
    await panel
      .getByRole("button", { name: "Start Chatting" })
      .click({ timeout: 10_000 })
      .catch(() => {})
    const composer = panel.getByPlaceholder("Type a message or ctrl + /")
    await composer.fill("what are we doing in this pr?")
    await composer.press("Enter")

    await expect(panel.getByText("It starts runs from chat.")).toBeVisible({
      timeout: 30_000
    })

    const first = chats[0]
    expect(first.tools?.map((tool) => tool.function?.name)).toContain(
      "current_tab"
    )
    const system = first.messages?.find((message) => message.role === "system")
    expect(system?.content).toContain("inside the user's web browser")
    expect(system?.content).toContain(
      `"${PAGE_TITLE}" at ${origin}/o/r/pull/421.`
    )
    expect(system?.content).not.toContain("tab=files")

    const toolResult = chats
      .at(-1)
      ?.messages?.find((message) => message.role === "tool")
    expect(toolResult?.content).toContain(PAGE_TEXT)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
