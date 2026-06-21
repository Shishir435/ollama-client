import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PerSiteProfilesEditor } from "@/features/permissions/components/per-site-profiles-editor"

const storage = vi.hoisted(() => ({
  value: { profiles: [] as unknown[] },
  setValue: vi.fn()
}))

const browserApi = vi.hoisted(() => ({
  query: vi.fn()
}))

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: () => [storage.value, storage.setValue]
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: {
      query: browserApi.query
    }
  }
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("PerSiteProfilesEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.value = { profiles: [] }
    browserApi.query.mockResolvedValue([
      { id: 1, url: "https://docs.example.com/path" }
    ])
  })

  it("adds a rule from a typed site pattern", () => {
    render(<PerSiteProfilesEditor />)

    fireEvent.change(
      screen.getByLabelText("settings.permissions.siteProfiles.fields.pattern"),
      { target: { value: "mail.example.com" } }
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: /settings.permissions.siteProfiles.actions.add/
      })
    )

    expect(storage.setValue).toHaveBeenCalledWith({
      profiles: [
        expect.objectContaining({
          pattern: "mail.example.com",
          tabContext: "never",
          groundedOnly: "inherit",
          enabled: true
        })
      ]
    })
  })

  it("adds the active tab hostname", async () => {
    render(<PerSiteProfilesEditor />)

    fireEvent.click(
      screen.getByRole("button", {
        name: /settings.permissions.siteProfiles.actions.currentSite/
      })
    )

    await waitFor(() =>
      expect(storage.setValue).toHaveBeenCalledWith({
        profiles: [
          expect.objectContaining({
            pattern: "docs.example.com"
          })
        ]
      })
    )
  })

  it("updates and deletes existing rules", () => {
    storage.value = {
      profiles: [
        {
          id: "docs",
          name: "Docs",
          pattern: "docs.example.com",
          enabled: true,
          tabContext: "always",
          groundedOnly: "inherit"
        }
      ]
    }

    render(<PerSiteProfilesEditor />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.permissions.siteProfiles.actions.delete"
      })
    )

    expect(storage.setValue).toHaveBeenCalledWith({ profiles: [] })
  })
})
