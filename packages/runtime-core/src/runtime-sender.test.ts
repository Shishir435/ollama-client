import { describe, expect, it } from "vitest"
import { classifyRuntimeSender } from "./runtime-sender"

const extensionId = "extension-id"
const extensionUrlPrefix = "chrome-extension://extension-id/"

describe("classifyRuntimeSender", () => {
  it("classifies extension pages, content scripts, and foreign senders", () => {
    expect(
      classifyRuntimeSender(
        { id: extensionId, url: `${extensionUrlPrefix}sidepanel.html` },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe("extension-page")
    expect(
      classifyRuntimeSender(
        { id: extensionId, tab: { id: 42 }, url: "https://example.com" },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe("content-script")
    expect(
      classifyRuntimeSender({ id: "foreign" }, extensionId, extensionUrlPrefix)
    ).toBe("untrusted")
  })

  it("recognizes extension pages opened in browser tabs", () => {
    expect(
      classifyRuntimeSender(
        {
          id: extensionId,
          tab: { id: 9 },
          origin: "chrome-extension://extension-id"
        },
        extensionId,
        extensionUrlPrefix
      )
    ).toBe("extension-page")
  })
})
