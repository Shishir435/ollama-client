import { expect, test } from "../../fixtures/extension"
import {
  lastPromptText,
  lastUserContent,
  openConfiguredPanel,
  startFakeChatServer
} from "../../fixtures/fake-chat-server"

/**
 * Three ways a person puts text in front of the chat without typing it: a PDF
 * open in a browser tab, text selected on a page, and a saved prompt template.
 * The scripted model only answers "Noted."; each test asserts on what the
 * extension actually sent it.
 */

const MODEL = "fixture-chat"

const ARTICLE = `<!doctype html><html><head><meta charset="utf-8"><title>Pelican field notes</title></head>
<body><main><h1>Pelican field notes</h1>
<p id="passage">The pelicans crossed the estuary at dawn, forty strong.</p>
<p>A second paragraph that is not selected.</p></main></body></html>`

/** Selects one element's text the way a drag would, then lets the page notice. */
const selectText = async (
  page: import("@playwright/test").Page,
  selector: string
) => {
  await page.evaluate((target) => {
    const node = document.querySelector(target)
    if (!node) throw new Error(`no ${target}`)
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  }, selector)
}

/** The tab row's title: the file name, or its address while the viewer loads. */
const pdfRow = (origin: string, file: string) =>
  new RegExp(
    `^(${new URL(origin).host.replace(/\./g, "\\.")}/files/)?${file.replace(".", "\\.")}$`
  )

/** Opens the composer's context sheet, where the tab list lives. */
const openTabList = (panel: import("@playwright/test").Page) =>
  panel.getByRole("button", { name: /^Context: / }).click()

test("@critical a PDF open in a tab is read as context, page by page", async ({
  extension
}) => {
  const server = await startFakeChatServer({ model: MODEL })
  try {
    const panel = await extension.context.newPage()
    await openConfiguredPanel(panel, extension.extensionId, {
      origin: server.origin,
      model: MODEL
    })
    const pdf = await extension.context.newPage()
    await pdf
      .goto(`${server.origin}/files/text.pdf`, { waitUntil: "commit" })
      .catch(() => {})
    await pdf.waitForTimeout(500)
    /** A backgrounded page cannot answer Playwright's rAF-based click checks. */
    await panel.bringToFront()

    await openTabList(panel)
    await panel
      .getByRole("button", {
        name: pdfRow(server.origin, "text.pdf")
      })
      .click()
    /** The row previews what was read, so its text appearing means the PDF was parsed. */
    await expect(
      panel.getByText("Quarterly pelican migration report")
    ).toBeVisible({ timeout: 30_000 })
    await panel.keyboard.press("Escape")

    const composer = panel.locator("#chat-input-textarea")
    await composer.fill("what is this report about?")
    await composer.press("Enter")
    await expect(panel.getByText("Noted.")).toBeVisible({ timeout: 30_000 })

    const prompt = lastPromptText(server.chats)
    expect(prompt).toContain("Quarterly pelican migration report")
    expect(prompt).toContain("--- Page 2 ---")
    expect(prompt).toContain("Second page mentions the zephyr protocol")
  } finally {
    await server.close()
  }
})

test("@critical a PDF with no text layer says so instead of showing Ready", async ({
  extension
}) => {
  const server = await startFakeChatServer({ model: MODEL })
  try {
    const panel = await extension.context.newPage()
    await openConfiguredPanel(panel, extension.extensionId, {
      origin: server.origin,
      model: MODEL
    })
    const pdf = await extension.context.newPage()
    await pdf
      .goto(`${server.origin}/files/scanned.pdf`, { waitUntil: "commit" })
      .catch(() => {})
    await pdf.waitForTimeout(500)
    /** A backgrounded page cannot answer Playwright's rAF-based click checks. */
    await panel.bringToFront()

    await openTabList(panel)
    await panel
      .getByRole("button", {
        name: pdfRow(server.origin, "scanned.pdf")
      })
      .click()

    await expect(
      panel.getByText("This PDF has no selectable text (it may be scanned).", {
        exact: false
      })
    ).toBeVisible({ timeout: 30_000 })
  } finally {
    await server.close()
  }
})

test("@critical selected page text is added to the chat as a chip and sent as a quote", async ({
  extension
}) => {
  const server = await startFakeChatServer({
    model: MODEL,
    pages: { "/notes": ARTICLE }
  })
  try {
    const panel = await extension.context.newPage()
    await openConfiguredPanel(panel, extension.extensionId, {
      origin: server.origin,
      model: MODEL
    })
    const page = await extension.context.newPage()
    await page.goto(`${server.origin}/notes?session=secret`)
    await page.bringToFront()

    await selectText(page, "#passage")
    await page
      .getByRole("button", { name: "Add to chat", exact: true })
      .click({ timeout: 15_000 })

    await panel.bringToFront()
    const chips = panel.getByRole("list", { name: "Selected page text" })
    await expect(chips).toContainText("The pelicans crossed the estuary")

    const composer = panel.locator("#chat-input-textarea")
    await composer.fill("how many were there?")
    await composer.press("Enter")
    await expect(panel.getByText("Noted.")).toBeVisible({ timeout: 30_000 })

    const sent = lastUserContent(server.chats)
    expect(sent).toContain("> The pelicans crossed the estuary at dawn")
    expect(sent).toContain("Source: Pelican field notes")
    expect(sent).toContain(`${server.origin}/notes`)
    /** The address names the page; its query string never reaches the model. */
    expect(sent).not.toContain("session=secret")
    expect(sent).toContain("how many were there?")
    /** Sent once: the chip is spent. */
    await expect(chips).toHaveCount(0)
  } finally {
    await server.close()
  }
})

test("@critical a selection chip can be removed before sending", async ({
  extension
}) => {
  const server = await startFakeChatServer({
    model: MODEL,
    pages: { "/notes": ARTICLE }
  })
  try {
    const panel = await extension.context.newPage()
    await openConfiguredPanel(panel, extension.extensionId, {
      origin: server.origin,
      model: MODEL
    })
    const page = await extension.context.newPage()
    await page.goto(`${server.origin}/notes`)
    await page.bringToFront()
    await selectText(page, "#passage")
    await page
      .getByRole("button", { name: "Add to chat", exact: true })
      .click({ timeout: 15_000 })

    await panel.bringToFront()
    const chips = panel.getByRole("list", { name: "Selected page text" })
    await expect(chips).toBeVisible()
    await chips.getByRole("button", { name: /^Remove selected text/ }).click()
    await expect(chips).toHaveCount(0)

    const composer = panel.locator("#chat-input-textarea")
    await composer.fill("hello")
    await composer.press("Enter")
    await expect(panel.getByText("Noted.")).toBeVisible({ timeout: 30_000 })
    expect(lastUserContent(server.chats)).not.toContain("pelicans")
  } finally {
    await server.close()
  }
})

test("@critical typing / in the composer inserts a prompt template", async ({
  extension
}) => {
  const server = await startFakeChatServer({ model: MODEL })
  try {
    const panel = await extension.context.newPage()
    await openConfiguredPanel(panel, extension.extensionId, {
      origin: server.origin,
      model: MODEL
    })
    const composer = panel.locator("#chat-input-textarea")
    await expect(composer).toHaveAttribute("placeholder", /type \/ for prompts/)

    await composer.click()
    await composer.pressSequentially("/summ")
    const menu = panel.getByRole("listbox", { name: "Prompt templates" })
    await expect(menu.getByRole("option")).toHaveCount(1)
    await expect(menu).toContainText("Summarize Content")

    await composer.press("Enter")
    await expect(composer).toHaveValue(/^Summarize the following content/)
    await expect(menu).toHaveCount(0)
    /** Choosing a template is not sending it. */
    expect(server.chats).toHaveLength(0)
  } finally {
    await server.close()
  }
})
