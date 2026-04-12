import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockPort } from "./test-utils"

const tabsQuery = vi.fn()
const tabsGet = vi.fn()
const tabsCreate = vi.fn()
const tabsUpdate = vi.fn()
const tabsRemove = vi.fn()
const tabsSendMessage = vi.fn()
const captureVisibleTab = vi.fn()
const downloadsDownload = vi.fn()
const windowsUpdate = vi.fn()
const getAllFrames = vi.fn()
const storageGet = vi.fn()

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: {
      query: tabsQuery,
      get: tabsGet,
      create: tabsCreate,
      update: tabsUpdate,
      remove: tabsRemove,
      sendMessage: tabsSendMessage,
      captureVisibleTab
    },
    downloads: {
      download: downloadsDownload
    },
    windows: {
      update: windowsUpdate
    },
    webNavigation: {
      getAllFrames
    }
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: storageGet
  }
}))

describe("handleAgentTask", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    storageGet.mockResolvedValue(undefined)
    tabsCreate.mockImplementation(async ({ url }: { url: string }) => ({
      id: 22,
      url,
      title: "New tab",
      windowId: 1,
      index: 2
    }))
    tabsUpdate.mockImplementation(
      async (tabId: number, updates: { url?: string; active?: boolean }) => ({
        id: tabId,
        url: updates.url || "https://www.google.com",
        title: "Updated tab",
        windowId: 1,
        index: 1
      })
    )
    tabsRemove.mockResolvedValue(undefined)
    downloadsDownload.mockResolvedValue(501)
    windowsUpdate.mockResolvedValue(undefined)
    getAllFrames.mockResolvedValue([{ frameId: 0 }])
    tabsQuery.mockResolvedValue([
      {
        id: 77,
        url: "chrome-extension://test/sidepanel.html",
        active: true,
        lastAccessed: 200
      },
      {
        id: 11,
        url: "https://www.google.com",
        active: true,
        lastAccessed: 100
      }
    ])
    tabsGet.mockImplementation(async (tabId: number) => {
      if (tabId === 77) {
        return {
          id: 77,
          url: "chrome-extension://test/sidepanel.html",
          title: "Sidepanel",
          windowId: 1,
          index: 0
        }
      }
      if (tabId === 22) {
        return {
          id: 22,
          url: "https://example.com/report.pdf",
          title: "Example",
          windowId: 1,
          index: 2
        }
      }
      return {
        id: tabId,
        url: "https://www.google.com",
        title: "Google",
        windowId: 1,
        index: 1
      }
    })
    tabsSendMessage.mockImplementation(
      async (_tabId: number, message: { type: string }) => {
        switch (message.type) {
          case "__agent_ping":
            return { alive: true }
          case "agent-read-page":
            return {
              success: true,
              data: { pageContent: 'textbox "Search" [ref_1]', elementCount: 1 }
            }
          case "agent-get-page-text":
            return { success: true, message: "Google homepage" }
          case "agent-get-elements":
            return {
              success: true,
              data: [
                {
                  id: "ref_1",
                  type: "link",
                  text: "Example PDF",
                  visible: true,
                  href: "https://example.com/report.pdf"
                }
              ]
            }
          default:
            return { success: true }
        }
      }
    )
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: "Task complete",
          tool_calls: [
            {
              id: "tool_1",
              function: {
                name: "task_complete",
                arguments: JSON.stringify({
                  success: true,
                  message: "Search completed"
                })
              }
            }
          ]
        }
      })
    } satisfies Partial<Response>)
  })

  it("posts a single done event for task completion without fallback error", async () => {
    const { handleAgentTask } = await import("../handle-agent-task")
    const mockPort = createMockPort("agent-port")

    await handleAgentTask(mockPort, {
      type: "agent-execute-task",
      payload: {
        task: "Search Google for cats",
        model: "qwen2.5",
        autoRepeat: false
      }
    })

    const postedMessages = vi
      .mocked(mockPort.postMessage)
      .mock.calls.map(
        ([message]) =>
          message as { type: string; message?: string; status?: string }
      )

    const doneMessages = postedMessages.filter(
      (message) => message.type === "done"
    )
    expect(doneMessages).toHaveLength(1)
    expect(doneMessages[0]).toEqual(
      expect.objectContaining({
        status: "done",
        message: "Search completed"
      })
    )
    expect(
      doneMessages.some((message) =>
        message.message?.includes("Reached maximum steps")
      )
    ).toBe(false)
  })

  it("falls back from a preferred extension tab to the latest active web tab", async () => {
    const { resolveTargetTabId } = await import(
      "@/lib/agent/browser-automation"
    )

    const resolvedTabId = await resolveTargetTabId(77)

    expect(resolvedTabId).toBe(11)
  })

  it("posts heartbeat status updates while waiting for a slow local model", async () => {
    vi.useFakeTimers()

    let rejectFetch: ((reason?: unknown) => void) | undefined
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectFetch = reject
        })
    ) as typeof fetch

    const { handleAgentTask } = await import("../handle-agent-task")
    const mockPort = createMockPort("agent-port")

    const taskPromise = handleAgentTask(mockPort, {
      type: "agent-execute-task",
      payload: {
        task: "Search Google for cats",
        model: "qwen2.5-coder:14b",
        autoRepeat: false
      }
    })

    await vi.advanceTimersByTimeAsync(10_000)

    const postedMessages = vi
      .mocked(mockPort.postMessage)
      .mock.calls.map(
        ([message]) =>
          message as { type: string; message?: string; heartbeat?: boolean }
      )

    expect(
      postedMessages.some(
        (message) =>
          message.type === "status" &&
          message.heartbeat === true &&
          message.message?.includes("Waiting for local model response")
      )
    ).toBe(true)

    rejectFetch?.(new Error("boom"))
    await taskPromise
  })

  it("marks video waits as contextual wait states instead of generic slow model work", async () => {
    vi.useFakeTimers()

    tabsSendMessage.mockImplementation(
      async (
        _tabId: number,
        message: { type: string; payload?: { type?: string } }
      ) => {
        switch (message.type) {
          case "__agent_ping":
            return { alive: true }
          case "agent-read-page":
            return {
              success: true,
              data: {
                pageContent: 'video "Lesson player" [ref_33]',
                elementCount: 1
              }
            }
          case "agent-get-page-text":
            return { success: true, message: "Lesson page" }
          case "agent-execute-action":
            if (message.payload?.type === "wait_for_video_end") {
              await new Promise((resolve) => setTimeout(resolve, 11_000))
              return {
                success: true,
                message: "The current video finished playback."
              }
            }
            return { success: true }
          default:
            return { success: true, data: [] }
        }
      }
    )

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "Wait for lesson completion",
            tool_calls: [
              {
                id: "tool_1",
                function: {
                  name: "wait_for_video_end",
                  arguments: JSON.stringify({})
                }
              }
            ]
          }
        })
      } satisfies Partial<Response>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "Task complete",
            tool_calls: [
              {
                id: "tool_2",
                function: {
                  name: "task_complete",
                  arguments: JSON.stringify({
                    success: true,
                    message: "Finished waiting"
                  })
                }
              }
            ]
          }
        })
      } satisfies Partial<Response>) as typeof fetch

    const { handleAgentTask } = await import("../handle-agent-task")
    const mockPort = createMockPort("agent-port")

    const taskPromise = handleAgentTask(mockPort, {
      type: "agent-execute-task",
      payload: {
        task: "Watch the current lesson",
        model: "qwen2.5",
        autoRepeat: true
      }
    })

    await vi.advanceTimersByTimeAsync(10_500)

    const postedMessages = vi.mocked(mockPort.postMessage).mock.calls.map(
      ([message]) =>
        message as {
          type: string
          message?: string
          heartbeat?: boolean
          waitContext?: string
        }
    )

    expect(
      postedMessages.some(
        (message) =>
          message.type === "status" &&
          message.waitContext === "video_playback" &&
          message.message?.includes("Waiting for the current video to finish")
      )
    ).toBe(true)

    expect(
      postedMessages.some(
        (message) =>
          message.type === "status" &&
          message.heartbeat === true &&
          message.waitContext === "video_playback"
      )
    ).toBe(true)

    await vi.advanceTimersByTimeAsync(1_000)
    await taskPromise
  })

  it("opens a link in a new tab without replacing the root tab", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "Open the result in a new tab",
            tool_calls: [
              {
                id: "tool_1",
                function: {
                  name: "open_link_in_new_tab",
                  arguments: JSON.stringify({
                    element_id: "ref_1"
                  })
                }
              }
            ]
          }
        })
      } satisfies Partial<Response>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "Task complete",
            tool_calls: [
              {
                id: "tool_2",
                function: {
                  name: "task_complete",
                  arguments: JSON.stringify({
                    success: true,
                    message: "Opened result in new tab"
                  })
                }
              }
            ]
          }
        })
      } satisfies Partial<Response>) as typeof fetch

    const { handleAgentTask } = await import("../handle-agent-task")
    const mockPort = createMockPort("agent-port")

    await handleAgentTask(mockPort, {
      type: "agent-execute-task",
      payload: {
        task: "Open the result in a new tab",
        model: "qwen2.5",
        autoRepeat: false
      }
    })

    expect(tabsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/report.pdf"
      })
    )
    expect(tabsUpdate).not.toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        url: "https://example.com/report.pdf"
      })
    )
  })

  it("downloads a link target via browser downloads", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "Download the PDF",
            tool_calls: [
              {
                id: "tool_1",
                function: {
                  name: "download_link",
                  arguments: JSON.stringify({
                    element_id: "ref_1",
                    filename: "report.pdf"
                  })
                }
              }
            ]
          }
        })
      } satisfies Partial<Response>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            content: "Task complete",
            tool_calls: [
              {
                id: "tool_2",
                function: {
                  name: "task_complete",
                  arguments: JSON.stringify({
                    success: true,
                    message: "Downloaded report"
                  })
                }
              }
            ]
          }
        })
      } satisfies Partial<Response>) as typeof fetch

    const { handleAgentTask } = await import("../handle-agent-task")
    const mockPort = createMockPort("agent-port")

    await handleAgentTask(mockPort, {
      type: "agent-execute-task",
      payload: {
        task: "Download the PDF link",
        model: "qwen2.5",
        autoRepeat: false
      }
    })

    expect(downloadsDownload).toHaveBeenCalledWith({
      url: "https://example.com/report.pdf",
      filename: "report.pdf",
      saveAs: false
    })
  })
})
