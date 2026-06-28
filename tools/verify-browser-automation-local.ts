#!/usr/bin/env node

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { chromium, firefox } from "playwright"
import type { BrowserContext, Page, ViewportSize } from "playwright"

interface ChromePreferences {
  extensions?: {
    settings?: Record<string, { manifest?: { name?: string } }>
  }
}

interface InstalledManifest {
  name?: string
}

interface OllamaStatus {
  ok: boolean
  model: string
  models: string[]
}

interface PageOllamaResult {
  ok: boolean
  url?: string
}

interface ChatVerificationResult {
  ok: boolean
  content: string
  error?: string
}

interface StaticServer {
  origin: string
  close: () => Promise<void>
}

interface StreamMessage {
  delta?: unknown
  done?: unknown
  error?: unknown
}

interface OllamaChatLine {
  message?: {
    content?: unknown
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const chromeExtensionPath = resolve("build/chrome-mv3-prod")
const firefoxBuildPath = resolve("build/firefox-mv2-prod")
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434"
const ollamaRequired = process.env.OLLAMA_REQUIRED === "true"
const ollamaChatModelOverride = process.env.OLLAMA_CHAT_MODEL || ""
const chatPrompt =
  process.env.OLLAMA_CHAT_PROMPT ||
  "Reply with one short sentence: local test ok."
const browserHeadful = process.env.BROWSER_HEADFUL === "true"
const screenshotDir = resolve("artifacts/frontend-smoke")
const optionsViewport: ViewportSize = { width: 1280, height: 900 }
const sidepanelViewport: ViewportSize = { width: 480, height: 820 }

const logStep = (label: string): void => {
  console.log(`\n=== ${label} ===`)
}

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message)
  }
}

const checkPageLoaded = async (
  page: Page,
  label: string,
  selector = "#app"
): Promise<void> => {
  await page.waitForLoadState("domcontentloaded")
  const hasMount = await page.evaluate<boolean, string>(
    (mountSelector: string) => Boolean(document.querySelector(mountSelector)),
    selector
  )
  assert(hasMount, `${label} did not mount expected selector: ${selector}`)
}

const installPageEvaluationHelpers = async (page: Page): Promise<void> => {
  const keepNamesShim = "globalThis.__name ??= (target, _value) => target"
  await page.addInitScript({ content: keepNamesShim })
  await page.evaluate(keepNamesShim)
}

const prepareVisualSmoke = async (
  page: Page,
  theme: string,
  locale = "en",
  viewport = optionsViewport
): Promise<void> => {
  // tsx/esbuild can inject its keep-names helper into serialized callbacks,
  // but Playwright evaluates them in a page where that helper does not exist.
  await installPageEvaluationHelpers(page)
  await page.evaluate<void, { requestedTheme: string; requestedLocale: string }>(
    ({ requestedTheme, requestedLocale }) => {
      function setExtensionStorage(
        values: Record<string, string>
      ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
          if (!globalThis.chrome?.storage?.sync) {
            resolve()
            return
          }

          globalThis.chrome.storage.sync.set(values, () => {
            const error = globalThis.chrome.runtime?.lastError
            if (error) {
              reject(new Error(error.message))
              return
            }

            resolve()
          })
        })
      }

      document.documentElement.classList.toggle("dark", requestedTheme === "dark")
      document.documentElement.dataset.theme = requestedTheme
      localStorage.setItem("theme", requestedTheme)
      localStorage.setItem("i18nextLng", requestedLocale)
      document.documentElement.lang = requestedLocale
      return setExtensionStorage({
        "app-language": JSON.stringify(requestedLocale),
        "light-dark-theme": JSON.stringify(
          JSON.stringify({
            state: { theme: requestedTheme },
            version: 0
          })
        )
      })
    },
    { requestedTheme: theme, requestedLocale: locale }
  )
  await page.setViewportSize(viewport)
  await page.reload({ waitUntil: "domcontentloaded" })
  await checkPageLoaded(page, "visual smoke page")
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(150)
}

const captureVisualSmoke = async (page: Page, name: string): Promise<void> => {
  mkdirSync(screenshotDir, { recursive: true })
  const target = resolve(screenshotDir, `${name}.png`)
  await page.screenshot({ path: target, fullPage: true })
  console.log(`Visual smoke screenshot: ${target}`)
}

const prepareSidepanelChatSmoke = async (page: Page): Promise<void> => {
  const firstRunDialog = page.getByRole("dialog")
  if (
    await firstRunDialog
      .waitFor({ state: "visible", timeout: 1500 })
      .then(() => true)
      .catch(() => false)
  ) {
    const dismiss = firstRunDialog.getByRole("button", {
      name: "Maybe later"
    })
    if (await dismiss.isVisible()) await dismiss.click()
    else await page.keyboard.press("Escape")
    await firstRunDialog.waitFor({ state: "hidden" })
  }

  const startChat = page.getByRole("button", { name: "Start Chatting" })
  if (await startChat.isVisible()) {
    await startChat.click()
  }
}

const captureOptionsTabSmoke = async (
  page: Page,
  tabKey: string,
  name: string,
  theme: string,
  locale: string
): Promise<void> => {
  await prepareVisualSmoke(page, theme, locale)
  const url = new URL(page.url())
  url.searchParams.set("tab", tabKey)
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" })
  await checkPageLoaded(page, `options ${tabKey} tab`)
  await page.waitForTimeout(250)
  await captureVisualSmoke(page, name)
}

const runChromiumExtensionChecks = async (
  ollamaModels: string[],
  forceHeadful = false
): Promise<void> => {
  logStep("Chromium Extension Automation")
  const userDataDir = mkdtempSync(`${tmpdir()}/ollama-client-chromium-`)
  let context: BrowserContext | undefined

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: !(browserHeadful || forceHeadful),
      args: [
        `--window-size=${optionsViewport.width},${optionsViewport.height}`,
        `--disable-extensions-except=${chromeExtensionPath}`,
        `--load-extension=${chromeExtensionPath}`
      ]
    })

    let extensionId = ""
    let [serviceWorker] = context.serviceWorkers()
    if (!serviceWorker) {
      try {
        serviceWorker = await context.waitForEvent("serviceworker", {
          timeout: 10000
        })
      } catch (_) {}
    }

    if (serviceWorker) {
      extensionId = new URL(serviceWorker.url()).host
    }

    // Fallback for cases where MV3 service worker is lazy and does not start immediately.
    if (!extensionId) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      extensionId = findExtensionIdFromInstalledFiles(userDataDir)
    }

    // Final fallback for profile formats where extension files are not under Extensions dir.
    if (!extensionId) {
      const preferencesPath = findFileRecursive(userDataDir, "Preferences")
      if (preferencesPath) {
        const preferences = JSON.parse(
          readFileSync(preferencesPath, "utf8")
        ) as ChromePreferences
        const settings = preferences?.extensions?.settings ?? {}

        for (const [id, value] of Object.entries(settings)) {
          const manifestName = value?.manifest?.name?.toLowerCase?.() ?? ""
          if (manifestName.includes("ollama client")) {
            extensionId = id
            break
          }
        }
      }
    }

    assert(Boolean(extensionId), "Failed to resolve Chromium extension id")
    console.log(`Extension loaded with id: ${extensionId}`)

    const optionsPage = await context.newPage()
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`)
    await checkPageLoaded(optionsPage, "Chromium options page")
    await prepareVisualSmoke(optionsPage, "light", "en")
    await captureVisualSmoke(optionsPage, "chromium-options-light")
    await captureOptionsTabSmoke(
      optionsPage,
      "models",
      "chromium-options-models-light",
      "light",
      "en"
    )
    await captureOptionsTabSmoke(
      optionsPage,
      "providers",
      "chromium-options-providers-light",
      "light",
      "en"
    )
    await captureOptionsTabSmoke(
      optionsPage,
      "permissions",
      "chromium-options-privacy-light",
      "light",
      "en"
    )
    await optionsPage.goto(
      `chrome-extension://${extensionId}/options.html?tab=permissions&focus=model-tools`
    )
    await checkPageLoaded(optionsPage, "Chromium model tools settings")
    await prepareVisualSmoke(optionsPage, "light", "en")
    await optionsPage.waitForTimeout(600)
    await captureVisualSmoke(optionsPage, "chromium-options-tools-light")
    await captureOptionsTabSmoke(
      optionsPage,
      "embeddings",
      "chromium-options-embeddings-dark-long-locale",
      "dark",
      "de"
    )
    await prepareVisualSmoke(optionsPage, "dark", "de")
    await captureVisualSmoke(optionsPage, "chromium-options-dark-long-locale")
    await checkOllamaFromPage(optionsPage, "Chromium extension context")
    if (ollamaModels.length > 0) {
      let chatVerified = false
      let lastError = null
      for (const model of ollamaModels.slice(0, 3)) {
        try {
          await verifyChatConversationFromExtension(optionsPage, model)
          chatVerified = true
          break
        } catch (error) {
          lastError = error
          console.warn(
            `Chromium chat verification failed for ${model}: ${String(error)}`
          )
        }
      }
      if (!chatVerified) {
        throw new Error(
          `Failed chat verification in Chromium for candidate models: ${ollamaModels
            .slice(0, 3)
            .join(", ")}. Last error: ${String(lastError)}`
        )
      }
    } else if (ollamaRequired) {
      throw new Error(
        "Ollama connectivity is required but no model was discovered for chat verification"
      )
    } else {
      console.warn("Skipping chat verification: no Ollama model discovered")
    }
    await optionsPage.close()

    const sidepanelPage = await context.newPage()
    await sidepanelPage.goto(
      `chrome-extension://${extensionId}/sidepanel.html`
    )
    await checkPageLoaded(sidepanelPage, "Chromium sidepanel page")
    await prepareVisualSmoke(sidepanelPage, "light", "en", sidepanelViewport)
    await prepareSidepanelChatSmoke(sidepanelPage)
    await captureVisualSmoke(sidepanelPage, "chromium-sidepanel-light")
    const contextButton = sidepanelPage.getByRole("button", { name: "Context" })
    if (await contextButton.isVisible()) {
      await contextButton.click()
      await captureVisualSmoke(sidepanelPage, "chromium-sidepanel-context-light")
      await sidepanelPage.keyboard.press("Escape")
    }
    await prepareVisualSmoke(sidepanelPage, "dark", "de", sidepanelViewport)
    await captureVisualSmoke(
      sidepanelPage,
      "chromium-sidepanel-dark-long-locale"
    )
    await sidepanelPage.close()

    console.log("Chromium extension checks passed")
  } finally {
    if (context) {
      await context.close()
    }
    rmSync(userDataDir, { recursive: true, force: true })
  }
}

const resolvePath = (...segments: string[]): string => resolve(...segments)

const findFileRecursive = (dir: string, targetName: string): string => {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = resolvePath(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isFile() && entry === targetName) {
      return fullPath
    }
    if (stats.isDirectory()) {
      const found = findFileRecursive(fullPath, targetName)
      if (found) {
        return found
      }
    }
  }
  return ""
}

const findExtensionIdFromInstalledFiles = (profileDir: string): string => {
  const extensionsRoot = findDirectoryRecursive(profileDir, "Extensions")
  if (!extensionsRoot) return ""

  const extensionIds = readdirSync(extensionsRoot)
  for (const extensionId of extensionIds) {
    const idPath = resolvePath(extensionsRoot, extensionId)
    const idStats = statSync(idPath)
    if (!idStats.isDirectory()) continue

    const versionDirs = readdirSync(idPath)
    for (const versionDir of versionDirs) {
      const manifestPath = resolvePath(idPath, versionDir, "manifest.json")
      try {
        const manifest = JSON.parse(
          readFileSync(manifestPath, "utf8")
        ) as InstalledManifest
        const name = String(manifest?.name || "").toLowerCase()
        if (name.includes("ollama client")) {
          return extensionId
        }
      } catch {
        // ignore malformed or missing manifest
      }
    }
  }

  return ""
}

const findDirectoryRecursive = (dir: string, targetName: string): string => {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = resolvePath(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      if (entry === targetName) {
        return fullPath
      }
      const found = findDirectoryRecursive(fullPath, targetName)
      if (found) return found
    }
  }
  return ""
}

const runFirefoxBundleChecks = async (
  ollamaModels: string[]
): Promise<void> => {
  logStep("Firefox Runtime Automation")
  const server = await startStaticServer(firefoxBuildPath)
  const browser = await firefox.launch({ headless: !browserHeadful })

  try {
    const context = await browser.newContext()

    const optionsPage = await context.newPage()
    await optionsPage.goto(`${server.origin}/options.html`)
    await checkPageLoaded(optionsPage, "Firefox options bundle")
    if (ollamaModels.length > 0) {
      let chatVerified = false
      let lastError = null
      for (const model of ollamaModels.slice(0, 3)) {
        try {
          await verifyChatConversationViaHttp(optionsPage, model, "Firefox")
          chatVerified = true
          break
        } catch (error) {
          lastError = error
          console.warn(
            `Firefox chat verification failed for ${model}: ${String(error)}`
          )
        }
      }
      if (!chatVerified) {
        throw new Error(
          `Failed chat verification in Firefox for candidate models: ${ollamaModels
            .slice(0, 3)
            .join(", ")}. Last error: ${String(lastError)}`
        )
      }
    } else if (ollamaRequired) {
      throw new Error(
        "Firefox chat verification requires an Ollama chat model, but none was discovered"
      )
    }
    await optionsPage.close()

    const sidepanelPage = await context.newPage()
    await sidepanelPage.goto(`${server.origin}/sidepanel.html`)
    await checkPageLoaded(sidepanelPage, "Firefox sidepanel bundle")
    await sidepanelPage.close()

    await context.close()
    console.log("Firefox runtime checks passed")
  } finally {
    await browser.close()
    await server.close()
  }
}

const fetchJsonWithTimeout = async (
  url: string,
  timeoutMs = 5000
): Promise<unknown> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

const getStringProperty = (value: unknown, property: string): string | null => {
  if (!isRecord(value)) return null
  const propertyValue = value[property]
  return typeof propertyValue === "string" ? propertyValue : null
}

const getOllamaTagModels = (data: unknown): string[] => {
  if (!isRecord(data) || !Array.isArray(data.models)) return []
  return data.models
    .map((model) => getStringProperty(model, "name"))
    .filter((model): model is string => Boolean(model))
}

const getOpenAIModelIds = (data: unknown): string[] => {
  if (!isRecord(data) || !Array.isArray(data.data)) return []
  return data.data
    .map((model) => getStringProperty(model, "id"))
    .filter((model): model is string => Boolean(model))
}

const checkOllamaNodeReachability = async (): Promise<OllamaStatus> => {
  logStep("Ollama Reachability (Node)")
  const endpoints = [`${ollamaBaseUrl}/api/tags`, `${ollamaBaseUrl}/v1/models`]
  let lastError = null

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJsonWithTimeout(endpoint, 7000)
      console.log(`Ollama reachable: ${endpoint}`)
      if (endpoint.endsWith("/api/tags")) {
        const models = pickChatModels(getOllamaTagModels(data))
        return { ok: true, model: models[0] || "", models }
      }

      const models = pickChatModels(getOpenAIModelIds(data))
      return { ok: true, model: models[0] || "", models }
    } catch (error) {
      lastError = error
    }
  }

  if (ollamaRequired) {
    throw new Error(
      `Ollama is required but unreachable at ${ollamaBaseUrl}. Last error: ${String(lastError)}`
    )
  }

  console.warn(
    `Skipping strict Ollama check: endpoint unreachable at ${ollamaBaseUrl}`
  )
  return { ok: false, model: "", models: [] }
}

const pickChatModels = (models: string[]): string[] => {
  if (ollamaChatModelOverride) {
    return [ollamaChatModelOverride]
  }

  const blockedHints = ["embed", "embedding", "minilm", "bge", "e5", "nomic-embed"]
  const chatCandidates = models.filter((model) => {
    const lower = String(model).toLowerCase()
    return !blockedHints.some((hint) => lower.includes(hint))
  })

  const priorityHints = ["gemma:1b", "gemma3:1b", "llama3.2:3b", "qwen3.5"]
  const prioritized: string[] = []

  for (const hint of priorityHints) {
    const match = chatCandidates.find((model) =>
      String(model).toLowerCase().includes(hint)
    )
    if (match && !prioritized.includes(match)) prioritized.push(match)
  }

  for (const model of chatCandidates) {
    if (!prioritized.includes(model)) prioritized.push(model)
  }

  if (prioritized.length > 0) return prioritized
  return models.length > 0 ? [models[0]] : []
}

const checkOllamaFromPage = async (
  page: Page,
  label: string
): Promise<void> => {
  const result = await page.evaluate<PageOllamaResult, string>(async (baseUrl) => {
    const urls = [`${baseUrl}/api/tags`, `${baseUrl}/v1/models`]
    for (const url of urls) {
      try {
        const response = await fetch(url)
        if (response.ok) {
          return { ok: true, url }
        }
      } catch {}
    }
    return { ok: false }
  }, ollamaBaseUrl)

  if (!result.ok) {
    if (ollamaRequired) {
      throw new Error(`${label} could not reach Ollama at ${ollamaBaseUrl}`)
    }
    console.warn(`${label}: Ollama check skipped (endpoint unreachable)`)
    return
  }

  console.log(`${label}: Ollama fetch succeeded via ${result.url}`)
}

const verifyChatConversationFromExtension = async (
  page: Page,
  model: string
): Promise<void> => {
  const response = await page.evaluate<
    ChatVerificationResult,
    { selectedModel: string; prompt: string }
  >(
    ({ selectedModel, prompt }) =>
      new Promise<ChatVerificationResult>((resolve) => {
        const port = chrome.runtime.connect({ name: "provider-stream-response" })
        let content = ""
        let finished = false

        function finish(result: ChatVerificationResult): void {
          if (finished) return
          finished = true
          try {
            port.disconnect()
          } catch {}
          resolve(result)
        }

        const timeout = setTimeout(() => {
          finish({
            ok: false,
            error: "Timed out waiting for chat stream data",
            content
          })
        }, 90000)

        port.onMessage.addListener((msg: StreamMessage) => {
          if (typeof msg?.delta === "string") {
            content += msg.delta
            if (content.trim().length > 0) {
              clearTimeout(timeout)
              finish({ ok: true, content })
              return
            }
          }

          if (msg?.error) {
            clearTimeout(timeout)
            const streamError = msg.error
            finish({
              ok: false,
              error:
                typeof streamError === "string"
                  ? streamError
                  : typeof streamError === "object" &&
                      streamError !== null &&
                      "message" in streamError &&
                      typeof streamError.message === "string"
                    ? streamError.message
                    : "Unknown stream error",
              content
            })
            return
          }

          if (msg?.done) {
            clearTimeout(timeout)
            finish({ ok: true, content })
          }
        })

        port.postMessage({
          type: "chat-with-model",
          payload: {
            model: selectedModel,
            providerId: "ollama",
            messages: [{ role: "user", content: prompt }]
          }
        })
      }),
    { selectedModel: model, prompt: chatPrompt }
  )

  assert(response?.ok, `Chat stream failed: ${response?.error || "unknown error"}`)
  assert(
    typeof response?.content === "string" && response.content.trim().length > 0,
    "Chat stream completed but returned empty assistant content"
  )
  console.log(
    `Chat conversation verified with model "${model}" (${response.content.trim().slice(0, 80)})`
  )
}

const verifyChatConversationViaHttp = async (
  page: Page,
  model: string,
  browserLabel: string
): Promise<void> => {
  await installPageEvaluationHelpers(page)
  const response = await page.evaluate<
    ChatVerificationResult,
    { baseUrl: string; selectedModel: string; prompt: string }
  >(
    ({ baseUrl, selectedModel, prompt }) =>
      new Promise<ChatVerificationResult>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            ok: false,
            error: "Timed out waiting for HTTP chat stream",
            content: ""
          })
        }, 90000)

        function finish(result: ChatVerificationResult): void {
          clearTimeout(timeout)
          resolve(result)
        }

        fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModel,
            stream: true,
            messages: [{ role: "user", content: prompt }]
          })
        })
          .then(async (res) => {
            if (!res.ok) {
              const text = await res.text()
              finish({
                ok: false,
                error: `HTTP ${res.status}: ${text}`,
                content: ""
              })
              return
            }

            const reader = res.body?.getReader()
            if (!reader) {
              finish({
                ok: false,
                error: "Missing response body reader",
                content: ""
              })
              return
            }

            const decoder = new TextDecoder()
            let buffer = ""
            let content = ""

            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                break
              }
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() || ""

              for (const line of lines) {
                if (!line.trim()) continue
                try {
                  const data = JSON.parse(line) as unknown
                  const parsed = data as OllamaChatLine
                  if (typeof parsed?.message?.content === "string") {
                    content += parsed.message.content
                  }
                } catch {}
              }
            }

            finish({ ok: true, content })
          })
          .catch((error) => {
            finish({
              ok: false,
              error: String(error),
              content: ""
            })
          })
      }),
    { baseUrl: ollamaBaseUrl, selectedModel: model, prompt: chatPrompt }
  )

  assert(
    response?.ok,
    `${browserLabel} chat stream failed: ${response?.error || "unknown error"}`
  )
  assert(
    typeof response?.content === "string" && response.content.trim().length > 0,
    `${browserLabel} chat stream completed but returned empty assistant content`
  )
  console.log(
    `${browserLabel} HTTP chat verified with model "${model}" (${response.content.trim().slice(0, 80)})`
  )
}

const startStaticServer = async (rootDir: string): Promise<StaticServer> => {
  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".png": "image/png"
  }

  const server = createServer((req, res) => {
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname
    const requestPath = pathname === "/" ? "/options.html" : pathname
    const filePath = resolve(rootDir, `.${requestPath}`)

    try {
      const file = readFileSync(filePath)
      const extension = filePath.slice(filePath.lastIndexOf("."))
      res.statusCode = 200
      res.setHeader(
        "Content-Type",
        mimeTypes[extension] || "application/octet-stream"
      )
      res.end(file)
    } catch {
      res.statusCode = 404
      res.end("Not Found")
    }
  })

  await new Promise<void>((resolve) => {
    server.listen({ port: 0, host: "127.0.0.1" }, () => resolve())
  })
  const address = server.address() as AddressInfo | null
  const port = address?.port ?? 0

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const main = async (): Promise<void> => {
  console.log(
    "Running local browser automation sequentially (Chromium -> Firefox)"
  )
  console.log(
    `Browser mode: ${browserHeadful ? "headful (visible)" : "headless (hidden)"}`
  )
  const ollamaStatus = await checkOllamaNodeReachability()
  try {
    await runChromiumExtensionChecks(ollamaStatus.models || [])
  } catch (error) {
    const message = String(error)
    const shouldRetryHeadful =
      !browserHeadful &&
      message.includes("Failed to resolve Chromium extension id")

    if (!shouldRetryHeadful) {
      throw error
    }

    console.warn(
      "Chromium hidden-mode extension bootstrap failed. Retrying once in visible mode..."
    )
    await runChromiumExtensionChecks(ollamaStatus.models || [], true)
  }
  await runFirefoxBundleChecks(ollamaStatus.models || [])
  console.log("\n✅ Local browser automation passed")
}

main().catch((error: unknown) => {
  console.error("\n❌ Local browser automation failed")
  console.error(error)
  process.exit(1)
})
