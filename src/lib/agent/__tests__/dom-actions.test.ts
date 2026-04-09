import { beforeEach, describe, expect, it, vi } from "vitest"
import { MESSAGE_KEYS } from "@/lib/constants"

let onMessageListener:
  | ((message: { type: string }, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
  | undefined

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener) => {
          onMessageListener = listener
        })
      }
    }
  }
}))

describe("dom-actions", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <main>
        <button aria-label="Search">Search</button>
        <a href="https://example.com/report.pdf">Download report</a>
        <input placeholder="Search query" />
      </main>
    `
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 120
    })
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => 32
    })
    HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 120,
      height: 32,
      top: 0,
      left: 0,
      right: 120,
      bottom: 32,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })) as any
    onMessageListener = undefined
    vi.clearAllMocks()
  })

  it("uses ref_ids for interactive elements and for vision-mode marks", async () => {
    const { getInteractiveElements, registerAgentActionListener } = await import(
      "../dom-actions"
    )

    const elements = getInteractiveElements()
    expect(elements).not.toHaveLength(0)
    expect(elements[0].id).toMatch(/^ref_\d+$/)

    registerAgentActionListener()
    const sendResponse = vi.fn()

    onMessageListener?.(
      { type: MESSAGE_KEYS.AGENT.DRAW_MARKS },
      undefined,
      sendResponse
    )

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )

    const markerIds = Array.from(document.body.querySelectorAll("div"))
      .map((element) => element.textContent?.trim())
      .filter(Boolean)

    expect(markerIds).toContain(String(elements[0].id))
  })

  it("submits a focused form when press_key receives Enter on an input ref_id", async () => {
    document.body.innerHTML = `
      <main>
        <form>
          <input placeholder="Search query" />
        </form>
      </main>
    `

    const form = document.querySelector("form") as HTMLFormElement
    const requestSubmit = vi.fn()
    form.requestSubmit = requestSubmit

    const { getInteractiveElements, registerAgentActionListener } = await import(
      "../dom-actions"
    )

    const inputRef = getInteractiveElements().find((element) =>
      ["input", "textarea"].includes(element.type)
    )?.id

    expect(inputRef).toMatch(/^ref_\d+$/)

    registerAgentActionListener()
    const sendResponse = vi.fn()

    onMessageListener?.(
      {
        type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
        payload: {
          type: "press_key",
          key: "Enter",
          element_id: inputRef
        }
      },
      undefined,
      sendResponse
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(requestSubmit).toHaveBeenCalledTimes(1)
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )
  })

  it("controls video playback with control_video", async () => {
    document.body.innerHTML = `
      <main>
        <video></video>
      </main>
    `

    const video = document.querySelector("video") as HTMLVideoElement
    let paused = true
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused
    })
    video.play = vi.fn(async () => {
      paused = false
    })
    video.pause = vi.fn(() => {
      paused = true
    })

    const { registerAgentActionListener } = await import("../dom-actions")
    registerAgentActionListener()

    const playResponse = vi.fn()
    onMessageListener?.(
      {
        type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
        payload: {
          type: "control_video",
          state: "play"
        }
      },
      undefined,
      playResponse
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(video.play).toHaveBeenCalledTimes(1)
    expect(playResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )

    const pauseResponse = vi.fn()
    onMessageListener?.(
      {
        type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
        payload: {
          type: "control_video",
          state: "pause"
        }
      },
      undefined,
      pauseResponse
    )

    await Promise.resolve()

    expect(video.pause).toHaveBeenCalledTimes(1)
    expect(pauseResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )
  })

  it("retries video playback with synthetic click fallback when play() is interrupted", async () => {
    document.body.innerHTML = `
      <main>
        <div class="player-shell">
          <video></video>
        </div>
      </main>
    `

    const video = document.querySelector("video") as HTMLVideoElement
    let paused = true
    let attempt = 0
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused
    })
    video.play = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) {
        throw new Error("The play() request was interrupted because video-only background media was paused to save power")
      }
      paused = false
    })

    const { registerAgentActionListener } = await import("../dom-actions")
    registerAgentActionListener()

    const response = vi.fn()
    onMessageListener?.(
      {
        type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
        payload: {
          type: "control_video",
          state: "play"
        }
      },
      undefined,
      response
    )

    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(video.play).toHaveBeenCalledTimes(2)
    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )
  })

  it("does not report a paused video as completed", async () => {
    document.body.innerHTML = `
      <main>
        <video></video>
      </main>
    `

    const video = document.querySelector("video") as HTMLVideoElement
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => true
    })
    Object.defineProperty(video, "ended", {
      configurable: true,
      get: () => false
    })
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 0
    })
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => 120
    })

    const { registerAgentActionListener } = await import("../dom-actions")
    registerAgentActionListener()

    const response = vi.fn()
    onMessageListener?.(
      {
        type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
        payload: {
          type: "wait_for_video_end",
          timeout_ms: 25
        } as any
      },
      undefined,
      response
    )

    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining("never started playing")
      })
    )
  })

  it("advances to the next lesson using the explicit next control", async () => {
    document.body.innerHTML = `
      <main>
        <button>Lezione successiva</button>
      </main>
    `

    let clicked = false
    const nextButton = document.querySelector("button") as HTMLButtonElement
    nextButton.addEventListener("click", () => {
      clicked = true
    })

    const { registerAgentActionListener } = await import("../dom-actions")
    registerAgentActionListener()

    const response = vi.fn()
    onMessageListener?.(
      {
        type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
        payload: {
          type: "advance_to_next_video"
        }
      },
      undefined,
      response
    )

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(clicked).toBe(true)
    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )
  })

  it("copies link URLs and page text to the clipboard", async () => {
    const { getInteractiveElements, registerAgentActionListener } = await import(
      "../dom-actions"
    )

    const linkRef = getInteractiveElements().find((element) => element.type === "link")?.id
    expect(linkRef).toMatch(/^ref_\d+$/)

    registerAgentActionListener()

    const copyLinkResponse = vi.fn()
    onMessageListener?.(
      {
        type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
        payload: {
          type: "copy_link_url",
          element_id: linkRef
        }
      },
      undefined,
      copyLinkResponse
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://example.com/report.pdf"
    )
    expect(copyLinkResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )

    const copyTextResponse = vi.fn()
    onMessageListener?.(
      {
        type: MESSAGE_KEYS.AGENT.EXECUTE_ACTION,
        payload: {
          type: "copy_page_text"
        }
      },
      undefined,
      copyTextResponse
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(copyTextResponse).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )
  })
})
