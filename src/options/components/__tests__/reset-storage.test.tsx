import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ResetStorage } from "../reset-storage"

const reset = vi.fn(async () => ({ ok: true }))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.module ? `${key}:${String(values.module)}` : key
  })
}))

vi.mock("@/hooks/use-reset-app-storage", () => ({
  useResetAppStorage: () => reset
}))

vi.mock("@/lib/app-reset", () => ({
  readAndClearResetFailure: vi.fn(async () => null)
}))

vi.mock("@/lib/get-all-reset-keys", () => ({
  getAllResetKeys: () => ({
    THEME: ["theme"],
    CHAT_SESSIONS: ["CHAT_SESSIONS"]
  })
}))

const moduleResetButtons = () =>
  screen.getAllByRole("button", { name: "settings.reset.reset_button" })

describe("ResetStorage", () => {
  beforeEach(() => {
    reset.mockClear()
  })

  it("asks before resetting a module and resets only after confirming", async () => {
    render(<ResetStorage />)

    fireEvent.click(moduleResetButtons()[0])

    expect(
      await screen.findByText(
        "settings.reset.module_dialog.title:settings.reset.modules.theme.title"
      )
    ).toBeInTheDocument()
    expect(reset).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.reset.module_dialog.confirm"
      })
    )

    await waitFor(() => expect(reset).toHaveBeenCalledWith("THEME"))
  })

  it("does not delete chats when the dialog is cancelled", async () => {
    render(<ResetStorage />)

    fireEvent.click(moduleResetButtons()[1])

    expect(
      await screen.findByText("settings.reset.chat_dialog.title")
    ).toBeInTheDocument()
    const confirm = screen.getByRole("button", {
      name: "settings.reset.chat_dialog.confirm"
    })
    expect(confirm).toHaveClass("text-destructive")

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }))

    await waitFor(() =>
      expect(
        screen.queryByText("settings.reset.chat_dialog.title")
      ).not.toBeInTheDocument()
    )
    expect(reset).not.toHaveBeenCalled()
  })

  it("erases everything only after the destructive confirmation", async () => {
    render(<ResetStorage />)

    fireEvent.click(
      screen.getByRole("button", { name: "settings.reset.danger_zone.button" })
    )
    expect(
      await screen.findByText("settings.reset.dialog.title")
    ).toBeInTheDocument()
    expect(reset).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole("button", { name: "settings.reset.dialog.confirm" })
    )

    await waitFor(() => expect(reset).toHaveBeenCalledWith("all"))
  })
})
