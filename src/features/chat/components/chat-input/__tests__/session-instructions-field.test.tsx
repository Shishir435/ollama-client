import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SessionInstructionsField } from "../session-instructions-field"

const { useChatSessionsMock } = vi.hoisted(() => ({
  useChatSessionsMock: vi.fn()
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  useChatSessions: useChatSessionsMock
}))

const sessions = [
  { id: "a", systemPrompt: "Answer in French" },
  { id: "b", systemPrompt: "Answer in German" }
]

describe("SessionInstructionsField", () => {
  beforeEach(() => {
    useChatSessionsMock.mockReturnValue({
      currentSessionId: "a",
      sessions,
      setSessionSystemPrompt: vi.fn().mockResolvedValue(undefined)
    })
  })

  it("writes the open chat's instructions to that chat", async () => {
    const setSessionSystemPrompt = vi.fn().mockResolvedValue(undefined)
    useChatSessionsMock.mockReturnValue({
      currentSessionId: "a",
      sessions,
      setSessionSystemPrompt
    })
    render(<SessionInstructionsField />)

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Answer in Hindi" }
    })
    fireEvent.click(
      screen.getByRole("button", { name: "chat.system_prompt.save" })
    )

    await waitFor(() =>
      expect(setSessionSystemPrompt).toHaveBeenCalledWith(
        "a",
        "Answer in Hindi"
      )
    )
  })

  it("leaves the newly opened chat's box alone when an earlier save lands", async () => {
    /**
     * The field used to write the saved value back after its await, so a save
     * for one chat that resolved after the user had opened another put the
     * first chat's instructions in the second chat's box — dirty, one Save
     * away from being stored there.
     */
    let settle: () => void = () => {}
    const setSessionSystemPrompt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    useChatSessionsMock.mockReturnValue({
      currentSessionId: "a",
      sessions,
      setSessionSystemPrompt
    })
    const view = render(<SessionInstructionsField />)

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Answer in Hindi" }
    })
    fireEvent.click(
      screen.getByRole("button", { name: "chat.system_prompt.save" })
    )

    // The user opens the other chat while the write is still in flight.
    useChatSessionsMock.mockReturnValue({
      currentSessionId: "b",
      sessions,
      setSessionSystemPrompt
    })
    view.rerender(<SessionInstructionsField />)
    settle()

    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("Answer in German")
    )
    expect(setSessionSystemPrompt).toHaveBeenCalledTimes(1)
    expect(setSessionSystemPrompt).toHaveBeenCalledWith("a", "Answer in Hindi")
  })
})
