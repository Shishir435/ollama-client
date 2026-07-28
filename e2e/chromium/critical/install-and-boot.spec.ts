import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "../fixtures/extension"

test("@critical production extension installs and boots", async ({
  extension
}) => {
  const manifest = JSON.parse(
    readFileSync(resolve(extension.buildPath, "manifest.json"), "utf8")
  ) as {
    manifest_version?: number
  }
  expect(manifest.manifest_version).toBe(3)
  expect(
    existsSync(resolve(extension.buildPath, "persistence-verify.html"))
  ).toBe(false)

  const [serviceWorker] = extension.context.serviceWorkers()
  expect(serviceWorker).toBeTruthy()
  expect(new URL(serviceWorker.url()).host).toBe(extension.extensionId)

  for (const extensionPage of ["options.html", "sidepanel.html"]) {
    const page = await extension.context.newPage()
    await page.goto(
      `chrome-extension://${extension.extensionId}/${extensionPage}`
    )
    await expect(page.locator("#app")).toBeVisible()
    await page.close()
  }
})
