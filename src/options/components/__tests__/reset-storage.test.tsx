import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readAndClearResetFailure } from "@/lib/app-reset"
import { ResetStorage } from "../reset-storage"

const reset = vi.fn(async () => ({ ok: true }))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.module ? `${key}:${String(values.module)}` : key
  })
}))

let exporting = false
const exportBackup = vi.fn(async () => true)
vi.mock("@/features/privacy/hooks/use-backup-export", () => ({
  useBackupExport: () => ({ exporting, exportBackup })
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
    CHAT_SESSIONS: ["CHAT_SESSIONS"],
    APP_LIFECYCLE: ["lifecycle"]
  })
}))

const moduleResetButtons = () =>
  screen.getAllByRole("button", { name: "settings.reset.reset_button" })

describe("ResetStorage", () => {
  beforeEach(() => {
    exporting = false
    reset.mockClear()
    exportBackup.mockClear()
  })

  it("blocks erase while the backup is exporting", async () => {
    const { rerender } = render(<ResetStorage />)
    fireEvent.click(
      screen.getByRole("button", { name: "settings.reset.danger_zone.button" })
    )
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "settings.reset.dialog.confirm_word" }
    })
    const confirm = screen.getByRole("button", {
      name: "settings.reset.dialog.confirm"
    })
    expect(confirm).toBeEnabled()
    exporting = true
    rerender(<ResetStorage />)
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(reset).not.toHaveBeenCalled()
    exporting = false
    rerender(<ResetStorage />)
    fireEvent.click(confirm)
    await waitFor(() => expect(reset).toHaveBeenCalledWith("all"))
  })

  it("says when a chat reset lost only the model settings", async () => {
    vi.mocked(readAndClearResetFailure).mockResolvedValueOnce({
      key: "CHAT_SESSIONS",
      error: "x",
      at: 1,
      preferencesNotRestored: true
    })
    render(<ResetStorage />)

    expect(
      await screen.findByText("settings.reset.failure_notice.preferences_title")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("settings.reset.failure_notice.title")
    ).not.toBeInTheDocument()
  })

  it("replaces the model-settings notice when a later reset fails", async () => {
    vi.mocked(readAndClearResetFailure).mockResolvedValueOnce({
      key: "CHAT_SESSIONS",
      error: "x",
      at: 1,
      preferencesNotRestored: true
    })
    reset.mockResolvedValueOnce({ ok: false })
    render(<ResetStorage />)
    await screen.findByText("settings.reset.failure_notice.preferences_title")

    fireEvent.click(moduleResetButtons()[0])
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.reset.module_dialog.confirm"
      })
    )

    expect(
      await screen.findByText("settings.reset.failure_notice.title")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("settings.reset.failure_notice.preferences_title")
    ).not.toBeInTheDocument()
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

  it("erases everything only after a backup offer and the typed word", async () => {
    render(<ResetStorage />)

    fireEvent.click(
      screen.getByRole("button", { name: "settings.reset.danger_zone.button" })
    )
    expect(
      await screen.findByText("settings.reset.dialog.title")
    ).toBeInTheDocument()
    expect(reset).not.toHaveBeenCalled()

    const confirm = screen.getByRole("button", {
      name: "settings.reset.dialog.confirm"
    })
    expect(confirm).toBeDisabled()

    fireEvent.click(
      screen.getByRole("button", { name: "settings.reset.dialog.export_first" })
    )
    expect(exportBackup).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()

    // The mocked `t` returns keys, so the word to type is the key itself.
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "wrong" }
    })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "settings.reset.dialog.confirm_word" }
    })
    expect(confirm).toBeEnabled()

    fireEvent.click(confirm)
    await waitFor(() => expect(reset).toHaveBeenCalledWith("all"))
  })

  it("keeps a finished module reset on screen until it is dismissed", async () => {
    render(<ResetStorage />)

    fireEvent.click(moduleResetButtons()[0])
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.reset.module_dialog.confirm"
      })
    )

    expect(await screen.findByText("settings.reset.done")).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 1700))
    expect(screen.getByText("settings.reset.done")).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: "settings.reset.dismiss" })
    )
    expect(screen.queryByText("settings.reset.done")).toBeNull()
  })

  it("uses the destructive style on every module reset button", () => {
    render(<ResetStorage />)
    for (const button of moduleResetButtons()) {
      expect(button).toHaveClass("bg-tint-danger")
    }
  })

  it("names a storage group without a title in words, not its key", () => {
    render(<ResetStorage />)

    expect(screen.getByText("App lifecycle")).toBeInTheDocument()
    expect(screen.queryByText("APP LIFECYCLE")).toBeNull()
  })
})
