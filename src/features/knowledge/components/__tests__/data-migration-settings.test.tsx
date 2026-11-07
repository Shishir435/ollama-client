import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DataMigrationSettings } from "../data-migration-settings"

const mocks = vi.hoisted(() => ({
  importAll: vi.fn(),
  exportAll: vi.fn(),
  scheduleReloadWithReopen: vi.fn(() => Promise.resolve())
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("@/lib/app-reset", () => ({
  scheduleReloadWithReopen: mocks.scheduleReloadWithReopen
}))
vi.mock("@/lib/backup-service", () => ({
  backupService: { importAll: mocks.importAll, exportAll: mocks.exportAll }
}))
vi.mock("@/components/settings", () => ({
  ConfirmActionDialog: ({
    open,
    onConfirm,
    confirmDisabled,
    description
  }: {
    open: boolean
    description: React.ReactNode
    confirmDisabled?: boolean
    onConfirm: () => void
  }) =>
    open ? (
      <div>
        {description}
        <button type="button" disabled={confirmDisabled} onClick={onConfirm}>
          confirm-import
        </button>
      </div>
    ) : null,
  SettingsCard: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsFormField: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

const ok = { ok: true }

const importFile = async () => {
  const { container } = render(<DataMigrationSettings />)
  const input = container.querySelector("input[type=file]") as HTMLInputElement
  fireEvent.change(input, {
    target: { files: [new File(["x"], "backup.zip")] }
  })
  fireEvent.click(await screen.findByText("confirm-import"))
  await screen.findByText("settings.migration.import_result.title")
}

describe("DataMigrationSettings import result", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.importAll.mockResolvedValue({
      syncStorage: ok,
      localStorage: ok,
      database: ok,
      dexie: { vectorDb: ok, knowledgeDb: ok },
      skippedStorageKeys: []
    })
  })

  it("blocks import until the backup export settles", async () => {
    let finishExport!: (value: Blob) => void
    mocks.exportAll.mockReturnValueOnce(
      new Promise((resolve) => {
        finishExport = resolve
      })
    )
    const { container } = render(<DataMigrationSettings />)
    fireEvent.change(container.querySelector("input[type=file]")!, {
      target: { files: [new File(["x"], "backup.zip")] }
    })
    fireEvent.click(
      screen.getByText("settings.migration.import_confirm.export_first")
    )
    const confirm = screen.getByText("confirm-import")
    expect(confirm).toBeDisabled()
    fireEvent.click(confirm)
    expect(mocks.importAll).not.toHaveBeenCalled()
    await act(async () => {
      finishExport(new Blob(["backup"]))
    })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.importAll).toHaveBeenCalledOnce())
  })

  it("is not dismissable by Escape after a restore and explains the reload", async () => {
    await importFile()
    expect(
      screen.getByText("settings.migration.import_result.reload_required")
    ).toBeTruthy()
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(
      screen.getByText("settings.migration.import_result.title")
    ).toBeTruthy()
    expect(mocks.scheduleReloadWithReopen).not.toHaveBeenCalled()
  })

  it("reloads only through the explicit button", async () => {
    await importFile()
    fireEvent.click(
      screen.getByText("settings.migration.import_result.reload_button")
    )
    await waitFor(() =>
      expect(mocks.scheduleReloadWithReopen).toHaveBeenCalledTimes(1)
    )
  })
})
