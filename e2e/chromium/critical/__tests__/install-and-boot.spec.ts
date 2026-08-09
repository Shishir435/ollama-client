import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "../../fixtures/extension"

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

  for (const extensionPage of ["options.html", "sidepanel.html"]) {
    const page = await extension.context.newPage()
    await page.goto(
      `chrome-extension://${extension.extensionId}/${extensionPage}`
    )
    await expect(page.locator("#app")).toBeVisible()
    const runtimeIdentity = await page.evaluate(() => ({
      id: chrome.runtime.id,
      manifestVersion: chrome.runtime.getManifest().manifest_version
    }))
    expect(runtimeIdentity).toEqual({
      id: extension.extensionId,
      manifestVersion: 3
    })
    await page.close()
  }

  // A resident worker is not an installation invariant: Chromium may suspend
  // an idle MV3 worker at any time. If one happens to be active, still verify
  // that it belongs to the installed extension.
  for (const serviceWorker of extension.context.serviceWorkers()) {
    expect(new URL(serviceWorker.url()).host).toBe(extension.extensionId)
  }
})
