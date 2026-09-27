import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { Builder } from "selenium-webdriver"
import firefox from "selenium-webdriver/firefox"

/** Disposable Firefox profile; extension-origin RPC exercises its actual background worker. */
const main = async () => {
  const uuid = "9c2522fa-7a43-4a53-8599-f87233406055"
  const profile = await mkdtemp("/private/tmp/olc-firefox-embeddings-")
  const options = new firefox.Options()
    .setBinary(
      process.env.FIREFOX_BIN ??
        "/Applications/Firefox.app/Contents/MacOS/firefox"
    )
    .addArguments("-headless", "-profile", profile)
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ "shishirchaurasiya435@gmail.com": uuid })
    )
    .setPreference("xpinstall.signatures.required", false)
    .setPreference("network.proxy.type", 1)
    .setPreference("network.proxy.http", "127.0.0.1")
    .setPreference("network.proxy.http_port", 9)
    .setPreference("network.proxy.ssl", "127.0.0.1")
    .setPreference("network.proxy.ssl_port", 9)
    .setPreference("network.proxy.no_proxies_on", "")
    .setPreference("network.proxy.allow_hijacking_localhost", true)
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(
      new firefox.ServiceBuilder(resolve("node_modules/.bin/geckodriver"))
        .addArguments("--allow-system-access")
        .enableVerboseLogging()
        .setStdio("inherit")
    )
    .build()
  const addon = driver as unknown as {
    installAddon: (path: string, temporary: boolean) => Promise<string>
    setContext: (context: string) => Promise<void>
  }
  try {
    await driver.manage().setTimeouts({ script: 120000 })
    await addon.installAddon(resolve("build/firefox-mv2-prod"), true)
    await addon.setContext(firefox.Context.CHROME)
    await driver.executeScript(
      `const win = Services.wm.getMostRecentWindow("navigator:browser"); win.gBrowser.selectedTab = win.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
      `moz-extension://${uuid}/options.html`
    )
    await addon.setContext(firefox.Context.CONTENT)
    await driver.wait(
      async () => (await driver.getAllWindowHandles()).length > 1,
      15000
    )
    await driver
      .switchTo()
      .window((await driver.getAllWindowHandles()).at(-1) ?? "")
    await driver.wait(
      async () =>
        driver.executeScript("return Boolean(window.browser?.runtime?.id)"),
      15000
    )
    const call = async (
      method: RpcMethod,
      request: Record<string, unknown> = {}
    ) => {
      const raw = (await driver.executeAsyncScript(
        `const done = arguments[arguments.length - 1]; browser.runtime.sendMessage({ type: "app-rpc-request", version: 1, requestId: crypto.randomUUID(), method: arguments[0], request: arguments[1] }).then(done, error => done({ failure: String(error) }));`,
        method,
        request
      )) as {
        ok: boolean
        result: {
          mode?: string
          migration?: string
          ok?: boolean
          embedding?: number[]
          providerId?: string
        }
      }
      assert.equal(raw.ok, true, JSON.stringify(raw))
      return raw.result
    }
    let status = await call(RpcMethod.EmbeddingsNativeStatus)
    for (
      let attempt = 0;
      attempt < 50 && status.mode !== "bundled";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      status = await call(RpcMethod.EmbeddingsNativeStatus)
    }
    assert.equal(status.mode, "bundled")
    const start = performance.now()
    const result = await call(RpcMethod.EmbeddingsGenerate, {
      text: "A kitten rests by a sunny window."
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.providerId, "bundled")
    assert.equal(result.embedding?.length, 384)
    assert.ok(result.embedding?.every(Number.isFinite))
    const coldMs = performance.now() - start
    await call(RpcMethod.EmbeddingsNativeCommand, { action: "external" })
    status = await call(RpcMethod.EmbeddingsNativeCommand, { action: "start" })
    for (
      let attempt = 0;
      attempt < 300 && status.migration === "building";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      status = await call(RpcMethod.EmbeddingsNativeStatus)
    }
    assert.equal(status.mode, "bundled")
    const artifact = resolve("artifacts/bundled-embeddings")
    await mkdir(artifact, { recursive: true })
    const report = {
      browser: (await driver.getCapabilities()).get("browserVersion"),
      coldMs,
      dimensions: result.embedding?.length,
      migration: "passed"
    }
    await writeFile(
      resolve(artifact, "firefox.json"),
      JSON.stringify(report, null, 2)
    )
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await driver.quit()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
