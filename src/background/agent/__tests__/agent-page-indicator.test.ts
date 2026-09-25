import { describe, expect, it, vi } from "vitest"
import { createAgentPageIndicator } from "../agent-page-indicator"

const harness = (fail?: string) => {
  const sent: string[] = []
  const send = vi.fn(async (method: string) => {
    sent.push(method)
    if (method === fail) throw new Error("refused")
    if (method === "Page.getLayoutMetrics")
      return { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } }
    if (method === "DOM.getNodeForLocation") return { backendNodeId: 42 }
    return {}
  })
  const enableDom = vi.fn(async () => {
    sent.push("DOM.enable")
  })
  return { indicator: createAgentPageIndicator(send, enableDom), send, sent }
}

describe("agent page indicator", () => {
  it("outlines the viewport through the debugger overlay", async () => {
    const { indicator, send } = harness()
    await indicator.show()
    expect(send).toHaveBeenCalledWith("Overlay.highlightRect", {
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      color: { r: 0, g: 0, b: 0, a: 0 },
      outlineColor: expect.objectContaining({ a: 0.9 })
    })
  })

  it("outlines the control under a pressed point", async () => {
    const { indicator, send } = harness()
    await indicator.target({ x: 10.4, y: 20.6 })
    expect(send).toHaveBeenCalledWith("DOM.getNodeForLocation", {
      x: 10,
      y: 21,
      includeUserAgentShadowDOM: false
    })
    expect(send).toHaveBeenCalledWith(
      "Overlay.highlightNode",
      expect.objectContaining({ backendNodeId: 42 })
    )
  })

  /**
   * A real Chromium draws the overlay into `Page.captureScreenshot`, so a
   * capture suspends it and nothing may redraw it until the capture is done.
   */
  it("draws nothing while suspended for a capture", async () => {
    const { indicator, sent } = harness()
    await indicator.suspend()
    sent.length = 0
    await indicator.show()
    await indicator.target({ x: 1, y: 1 })
    expect(sent).toEqual([])
    await indicator.resume()
    expect(sent).toContain("Overlay.highlightRect")
  })

  it("never throws when the overlay cannot be drawn", async () => {
    const { indicator, sent } = harness("Overlay.enable")
    await expect(indicator.show()).resolves.toBeUndefined()
    await expect(indicator.target({ x: 1, y: 1 })).resolves.toBeUndefined()
    expect(sent).not.toContain("Overlay.highlightRect")
  })
})
