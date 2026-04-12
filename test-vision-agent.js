import path from "path"
import { chromium } from "playwright"

;(async () => {
  const extensionPath = path.resolve("./build/chrome-mv3-prod")
  console.log("Loading extension from", extensionPath)

  const browser = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  })

  const page = await browser.newPage()

  // Navigate to test page
  console.log("Navigating to test page...")
  await page.goto("file://" + path.resolve("./camera-test.html"))

  // Check if extension background is running
  const background = browser.serviceWorkers()
  console.log("Service workers:", background.length)

  // Monitor network requests on background worker?
  // No, the UI and API calls happen from background script.
  // We can intercept page POST requests to localhost:11434
  page.on("request", (req) => {
    if (req.url().includes("/api/chat")) {
      console.log("Ollama request detected!")
      const data = JSON.parse(req.postData() || "{}")
      console.log("Request messages count:", data.messages?.length)
      const lastMsg = data.messages?.[data.messages.length - 1]
      if (lastMsg?.images?.[0]) {
        console.log("SUCCESS: Image was attached to the last message!")
        console.log("Image size (chars):", lastMsg.images[0].length)
      } else {
        console.log("FAIL: No images found in the request.")
      }
    }
  })

  // Open the extension sidepanel/popup.
  // Since we don't have the extension UI readily available in a normal tab,
  // we can load the sidepanel HTML in a new tab to interact with it.
  const sidepanelTab = await browser.newPage()
  // Find extension ID
  let extId = ""
  const targets = await browser.pages()
  for (const t of targets) {
    if (t.url().startsWith("chrome-extension://")) {
      extId = new URL(t.url()).hostname
      break
    }
  }
  // Wait a bit to ensure extension is fully loaded
  await new Promise((r) => setTimeout(r, 2000))

  if (!extId && background.length > 0) {
    extId = new URL(background[0].url()).hostname
  }

  if (!extId) {
    console.log("Could not find extension ID.")
    await browser.close()
    return
  }

  console.log("Extension ID:", extId)
  await sidepanelTab.goto(`chrome-extension://${extId}/sidepanel.html`)

  console.log("Opened sidepanel in a tab")
  await sidepanelTab.waitForTimeout(3000) // Wait for React to mount

  // Check the DOM structure of sidepanel
  try {
    const html = await sidepanelTab.innerHTML("body")
    console.log("Sidepanel loaded")

    // We need to enable vision mode.
    // The VisionModeToggle has title "Vision Agent Mode OFF"
    console.log("Attempting to click Vision Mode toggle...")

    // The button might not appear if the model isn't set to a vision model.
    // Let's set a vision model first if possible.
    // In our test, maybe we can just programmatically set it via plasmoGlobalStorage.
    // To do that, we can execute script in sidepanel.
    await sidepanelTab.evaluate(async () => {
      // Mock the storage
      const storageKeys = {
        VISION_MODE_ENABLED: "agent-vision-mode-enabled",
        MODE_ENABLED: "agent-mode-enabled"
      }
      // We can't access plasmoGlobalStorage directly easily, but we can set local storage if it's synced,
      // or we just click standard elements.
    })

    // Alternatively, we can let the test manually stay open for 30 seconds so I can observe it.
    console.log("Keep browser open for 15s to observe...")
    await new Promise((r) => setTimeout(r, 15000))
  } catch (e) {
    console.error("Error interacting with sidepanel:", e)
  }

  await browser.close()
})()
