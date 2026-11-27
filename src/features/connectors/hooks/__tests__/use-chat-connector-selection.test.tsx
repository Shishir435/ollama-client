import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  sessions: [] as Array<{ id: string; disabledConnectorIds?: string[] }>,
  currentSessionId: "s1" as string | null,
  createSession: vi.fn(async () => {
    state.sessions = [...state.sessions, { id: "created" }]
    return "created"
  }),
  setSessionDisabledConnectors: vi.fn(async (id: string, ids: string[]) => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    state.sessions = state.sessions.map((session) =>
      session.id === id ? { ...session, disabledConnectorIds: ids } : session
    )
  }),
  connectors: [] as unknown[]
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: { getState: () => state },
  useChatSessions: () => ({
    sessions: state.sessions,
    currentSessionId: state.currentSessionId,
    createSession: state.createSession,
    setSessionDisabledConnectors: state.setSessionDisabledConnectors
  })
}))
vi.mock("../connector-commands", () => ({
  loadConnectors: vi.fn(async () => state.connectors)
}))

import { useChatConnectorSelection } from "../use-chat-connector-selection"

const connector = (
  id: string,
  overrides: Record<string, unknown> = {}
): unknown => ({
  id,
  name: id,
  enabled: true,
  tools: [{ name: "t", enabled: true }],
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
  state.sessions = [{ id: "s1" }]
  state.currentSessionId = "s1"
})

describe("useChatConnectorSelection", () => {
  it("offers only enabled connectors that have an enabled tool, all on by default", async () => {
    state.connectors = [
      connector("mail"),
      connector("off", { enabled: false }),
      connector("empty", { tools: [{ name: "t", enabled: false }] })
    ]
    const { result } = renderHook(() => useChatConnectorSelection())

    await waitFor(() => expect(result.current.connectors).toHaveLength(1))
    expect(result.current.connectors[0].id).toBe("mail")
    expect(result.current.isEnabledForChat("mail")).toBe(true)
  })

  it("reads the stored exclusion list of the open chat", async () => {
    state.connectors = [connector("mail"), connector("notes")]
    state.sessions = [{ id: "s1", disabledConnectorIds: ["notes"] }]
    const { result } = renderHook(() => useChatConnectorSelection())

    await waitFor(() => expect(result.current.connectors).toHaveLength(2))
    expect(result.current.isEnabledForChat("mail")).toBe(true)
    expect(result.current.isEnabledForChat("notes")).toBe(false)
  })

  it("persists a toggle against the open chat, adding then removing the id", async () => {
    state.connectors = [connector("mail"), connector("notes")]
    state.sessions = [{ id: "s1", disabledConnectorIds: ["notes"] }]
    const { result } = renderHook(() => useChatConnectorSelection())
    await waitFor(() => expect(result.current.connectors).toHaveLength(2))

    await act(() => result.current.toggle("mail"))
    expect(state.setSessionDisabledConnectors).toHaveBeenLastCalledWith("s1", [
      "notes",
      "mail"
    ])

    await act(() => result.current.toggle("notes"))
    expect(state.setSessionDisabledConnectors).toHaveBeenLastCalledWith("s1", [
      "mail"
    ])
  })

  it("keeps both choices when a second click lands before the first save", async () => {
    state.connectors = [connector("mail"), connector("notes")]
    const { result } = renderHook(() => useChatConnectorSelection())
    await waitFor(() => expect(result.current.connectors).toHaveLength(2))

    await act(() => {
      void result.current.toggle("mail")
      return result.current.toggle("notes")
    })
    expect(state.setSessionDisabledConnectors).toHaveBeenLastCalledWith("s1", [
      "mail",
      "notes"
    ])
  })

  it("saves a click against the chat that was open when it was made", async () => {
    state.connectors = [connector("mail"), connector("notes")]
    state.sessions = [{ id: "s1" }, { id: "s2" }]
    const { result } = renderHook(() => useChatConnectorSelection())
    await waitFor(() => expect(result.current.connectors).toHaveLength(2))

    await act(() => {
      void result.current.toggle("mail")
      const second = result.current.toggle("notes")
      state.currentSessionId = "s2"
      return second
    })
    expect(state.setSessionDisabledConnectors).toHaveBeenLastCalledWith("s1", [
      "mail",
      "notes"
    ])
  })

  it("creates the chat first when there is none yet", async () => {
    state.connectors = [connector("mail")]
    state.currentSessionId = null
    state.sessions = []
    const { result } = renderHook(() => useChatConnectorSelection())
    await waitFor(() => expect(result.current.connectors).toHaveLength(1))

    await act(() => result.current.toggle("mail"))

    expect(state.createSession).toHaveBeenCalledTimes(1)
    expect(state.setSessionDisabledConnectors).toHaveBeenCalledWith("created", [
      "mail"
    ])
  })
  it("saves clicks made before any chat existed to the chat they create, not to one opened later", async () => {
    state.connectors = [connector("mail"), connector("notes")]
    state.currentSessionId = null
    state.sessions = [{ id: "s2" }]
    const { result } = renderHook(() => useChatConnectorSelection())
    await waitFor(() => expect(result.current.connectors).toHaveLength(2))

    await act(() => {
      void result.current.toggle("mail")
      const second = result.current.toggle("notes")
      state.currentSessionId = "s2"
      return second
    })
    expect(state.createSession).toHaveBeenCalledTimes(1)
    expect(state.setSessionDisabledConnectors).toHaveBeenLastCalledWith(
      "created",
      ["mail", "notes"]
    )
    expect(state.setSessionDisabledConnectors).not.toHaveBeenCalledWith(
      "s2",
      expect.anything()
    )
  })
  it("keeps clicks made while the first chat is being created on that chat", async () => {
    state.connectors = [connector("mail"), connector("notes"), connector("web")]
    state.currentSessionId = null
    state.sessions = []
    let created = () => {}
    state.createSession.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          created = () => {
            state.sessions = [{ id: "created" }]
            state.currentSessionId = "created"
            resolve("created")
          }
        })
    )
    const { result } = renderHook(() => useChatConnectorSelection())
    await waitFor(() => expect(result.current.connectors).toHaveLength(3))

    await act(async () => {
      void result.current.toggle("mail")
      void result.current.toggle("notes")
      await waitFor(() => expect(state.createSession).toHaveBeenCalled())
      created()
      await Promise.resolve()
      await result.current.toggle("web")
    })
    expect(state.createSession).toHaveBeenCalledTimes(1)
    expect(state.setSessionDisabledConnectors).toHaveBeenLastCalledWith(
      "created",
      ["mail", "notes", "web"]
    )
  })
  it("creates a new chat for a click once the last one is gone", async () => {
    state.connectors = [connector("mail"), connector("notes")]
    state.currentSessionId = null
    state.sessions = []
    state.createSession
      .mockImplementationOnce(async () => {
        state.sessions = [{ id: "c1" }]
        return "c1"
      })
      .mockImplementationOnce(async () => {
        state.sessions = [{ id: "c2" }]
        return "c2"
      })
    const { result } = renderHook(() => useChatConnectorSelection())
    await waitFor(() => expect(result.current.connectors).toHaveLength(2))

    await act(() => result.current.toggle("mail"))
    state.sessions = []
    await act(() => result.current.toggle("notes"))

    expect(state.setSessionDisabledConnectors).toHaveBeenLastCalledWith("c2", [
      "notes"
    ])
  })
})
