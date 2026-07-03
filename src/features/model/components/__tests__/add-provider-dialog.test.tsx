import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { AddProviderDialog } from "../add-provider-dialog"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("AddProviderDialog", () => {
  it("adds a native Anthropic provider with manual models", async () => {
    const onAdd = vi.fn().mockResolvedValue(true)
    const onOpenChange = vi.fn()
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={onOpenChange} onAdd={onAdd} />
      </TooltipProvider>
    )

    fireEvent.change(
      screen.getByLabelText("settings.providers.add.name_label"),
      { target: { value: "Claude" } }
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.providers\.add\.wire_anthropic/
      })
    )
    expect(
      screen.getByDisplayValue("https://api.anthropic.com/v1")
    ).toBeInTheDocument()

    const submit = screen.getByRole("button", {
      name: "settings.providers.add.submit"
    })
    expect(submit).toBeDisabled()

    fireEvent.change(
      screen.getByLabelText("settings.providers.add.api_key_required_label"),
      { target: { value: "sk-ant-test" } }
    )
    const modelInput = screen.getByPlaceholderText(
      "settings.providers.models.placeholder"
    )
    fireEvent.change(modelInput, { target: { value: "claude-sonnet" } })
    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.models.add" })
    )
    fireEvent.click(submit)

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        name: "Claude",
        baseUrl: "https://api.anthropic.com/v1",
        wire: "anthropic",
        apiKey: "sk-ant-test",
        customModels: ["claude-sonnet"]
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
