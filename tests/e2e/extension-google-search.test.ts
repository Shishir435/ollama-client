import { expect, test } from "playwright/test"
import {
  launchExtensionContext,
  mockOllamaForTask,
  openSidepanel,
  runAgentTask
} from "./extension-test-utils"

test("Extension can trigger google search", async () => {
  test.setTimeout(120000)
  const { context, extensionId } = await launchExtensionContext()
  await mockOllamaForTask(
    context,
    /Search Google for test/i,
    ({ content, step }) => {
      const searchRef =
        content.match(/(?:textbox|combobox)[^\n]*Search[^\n]*\[(ref_\d+)\]/i)?.[1] ||
        content.match(/textbox[^\n]*\[(ref_\d+)\]/i)?.[1] ||
        content.match(/combobox[^\n]*\[(ref_\d+)\]/i)?.[1]

      if (!searchRef) {
        throw new Error(`Google search input ref not found in content:\n${content}`)
      }

      if (step === 1) {
        return {
          name: "fill_input",
          args: {
            element_id: searchRef,
            value: "test"
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

  const sidepanelPage = await openSidepanel(context, extensionId)
  const result = await runAgentTask(sidepanelPage, "Search Google for test", {
    targetUrlIncludes: "google.com"
  })

  expect(result.status).toBe("done")
  await expect(page).toHaveURL(/google\.[^/]+\/search/i, { timeout: 30000 })
  await context.close()
})
