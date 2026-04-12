import { expect, test } from "playwright/test"
import {
  launchExtensionContext,
  mockOllamaForTask,
  openSidepanel,
  runAgentTask
} from "./extension-test-utils"

const enabled = process.env.EXTENSION_E2E === "1"

test.describe("extension agent smoke", () => {
  test.skip(
    !enabled,
    "Set EXTENSION_E2E=1 to run browser-extension smoke tests"
  )
  test.describe.configure({ mode: "serial" })
  test.setTimeout(120000)

  test("google search via agent task", async () => {
    const { context, extensionId } = await launchExtensionContext()
    await mockOllamaForTask(
      context,
      /Search Google for OpenAI/i,
      ({ content, step }) => {
        const searchRef =
          content.match(
            /(?:textbox|combobox)[^\n]*Search[^\n]*\[(ref_\d+)\]/i
          )?.[1] ||
          content.match(/textbox[^\n]*\[(ref_\d+)\]/i)?.[1] ||
          content.match(/combobox[^\n]*\[(ref_\d+)\]/i)?.[1]

        if (!searchRef) {
          throw new Error(
            `Google search input ref not found in content:\n${content}`
          )
        }

        if (step === 1) {
          return {
            name: "fill_input",
            args: {
              element_id: searchRef,
              value: "OpenAI"
            }
          }
        }

        if (step === 2) {
          return {
            name: "press_key",
            args: {
              key: "Enter",
              element_id: searchRef
            }
          }
        }

        return null
      },
      "Google search completed"
    )

    const page = await context.newPage()
    await page.goto("https://www.google.com/ncr?hl=en", {
      waitUntil: "domcontentloaded"
    })
    const sidepanel = await openSidepanel(context, extensionId)
    const result = await runAgentTask(sidepanel, "Search Google for OpenAI", {
      targetUrlIncludes: "google.com"
    })

    expect(result.status).toBe("done")
    await expect(page).toHaveURL(/google\.[^/]+\/search/i, { timeout: 30000 })
    await context.close()
  })

  test("youtube play pause via agent task", async () => {
    const { context, extensionId } = await launchExtensionContext()
    await mockOllamaForTask(
      context,
      /YouTube video/i,
      ({ content, step }) => {
        if (step > 1) {
          return null
        }

        const shouldPause = /Pause the YouTube video/i.test(content)
        return {
          name: "control_video",
          args: {
            state: shouldPause ? "pause" : "play"
          }
        }
      },
      "YouTube control completed"
    )

    const page = await context.newPage()
    await page.goto(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1",
      {
        waitUntil: "domcontentloaded"
      }
    )
    const initialPaused = await page
      .locator("video")
      .evaluate((video) => video.paused)

    const sidepanel = await openSidepanel(context, extensionId)
    const firstTask = initialPaused
      ? "Resume the YouTube video"
      : "Pause the YouTube video"
    const secondTask = initialPaused
      ? "Pause the YouTube video"
      : "Resume the YouTube video"

    const firstResult = await runAgentTask(sidepanel, firstTask, {
      targetUrlIncludes: "youtube.com/embed/"
    })
    expect(firstResult.status).toBe("done")
    await expect
      .poll(
        async () =>
          page.locator("video").evaluate(async (video) => {
            await new Promise((resolve) => setTimeout(resolve, 500))
            return video.paused
          }),
        { timeout: 15000 }
      )
      .toBe(!initialPaused)

    const secondResult = await runAgentTask(sidepanel, secondTask, {
      targetUrlIncludes: "youtube.com/embed/"
    })
    expect(secondResult.status).toBe("done")
    await expect
      .poll(
        async () =>
          page.locator("video").evaluate(async (video) => {
            await new Promise((resolve) => setTimeout(resolve, 500))
            return video.paused
          }),
        { timeout: 15000 }
      )
      .toBe(initialPaused)
    await context.close()
  })

  test("agent preserves the root tab when opening a link in a new tab", async () => {
    const { context, extensionId } = await launchExtensionContext()

    await context.route("http://agent.test/**", async (route) => {
      const url = route.request().url()
      if (url.endsWith("/root")) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `
            <html>
              <body>
                <h1>Root Workspace</h1>
                <a href="http://agent.test/doc">Open linked document</a>
              </body>
            </html>
          `
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `
          <html>
            <body>
              <h1>Document Tab</h1>
              <p>Opened in a separate tab.</p>
            </body>
          </html>
        `
      })
    })

    await mockOllamaForTask(
      context,
      /Open the linked document in a new tab/i,
      ({ content, step }) => {
        const linkRef =
          content.match(
            /link[^\n]*Open linked document[^\n]*\[(ref_\d+)\]/i
          )?.[1] || content.match(/link[^\n]*\[(ref_\d+)\]/i)?.[1]

        if (!linkRef) {
          throw new Error(
            `Linked document ref not found in content:\n${content}`
          )
        }

        if (step === 1) {
          return {
            name: "open_link_in_new_tab",
            args: {
              element_id: linkRef
            }
          }
        }

        if (step === 2) {
          return {
            name: "return_to_root_tab",
            args: {}
          }
        }

        return null
      },
      "Opened the document in a new tab and returned to the root tab"
    )

    const rootPage = await context.newPage()
    await rootPage.goto("http://agent.test/root", {
      waitUntil: "domcontentloaded"
    })

    const sidepanel = await openSidepanel(context, extensionId)
    const result = await runAgentTask(
      sidepanel,
      "Open the linked document in a new tab and then return to the original page",
      {
        targetUrlIncludes: "agent.test/root"
      }
    )

    expect(result.status).toBe("done")
    await expect(rootPage).toHaveURL("http://agent.test/root")

    await expect
      .poll(
        () =>
          sidepanel.evaluate(async () => {
            const tabs = await chrome.tabs.query({})
            return tabs
              .map((tab) => tab.url || "")
              .filter((url) => url.startsWith("http://agent.test/"))
          }),
        { timeout: 10000 }
      )
      .toContain("http://agent.test/doc")

    const urls = await sidepanel.evaluate(async () => {
      const tabs = await chrome.tabs.query({})
      return tabs
        .map((tab) => tab.url || "")
        .filter((url) => url.startsWith("http://agent.test/"))
    })

    expect(urls).toContain("http://agent.test/root")

    await context.close()
  })
})
