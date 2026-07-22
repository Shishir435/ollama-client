import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { ProviderServiceProfile } from "@/lib/providers/types"
import { AddProviderDialog } from "../add-provider-dialog"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("AddProviderDialog", () => {
  it("labels custom provider setup as beta", () => {
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={vi.fn()} />
      </TooltipProvider>
    )

    expect(
      screen.getByText("settings.providers.beta_badge")
    ).toBeInTheDocument()
  })

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
        name: /^settings\.providers\.add\.wire_anthropic settings\.providers\.add\.wire_anthropic_description$/
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
        customModels: ["claude-sonnet"],
        serviceProfile: ProviderServiceProfile.ANTHROPIC
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("preconfigures OpenRouter on the OpenAI-compatible wire", async () => {
    const onAdd = vi.fn().mockResolvedValue(true)
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={onAdd} />
      </TooltipProvider>
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.providers\.add\.wire_openrouter/
      })
    )
    expect(screen.getByDisplayValue("OpenRouter")).toBeInTheDocument()
    expect(
      screen.getByDisplayValue("https://openrouter.ai/api/v1")
    ).toBeInTheDocument()
    fireEvent.change(
      screen.getByLabelText("settings.providers.add.api_key_required_label"),
      { target: { value: "sk-or-test" } }
    )
    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.add.submit" })
    )

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        name: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        wire: "openai",
        apiKey: "sk-or-test",
        customModels: [],
        serviceProfile: ProviderServiceProfile.OPENROUTER
      })
    )
  })

  it("preconfigures the hosted OpenAI API with required credentials", async () => {
    const onAdd = vi.fn().mockResolvedValue(true)
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={onAdd} />
      </TooltipProvider>
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.providers\.add\.wire_openai_api/
      })
    )
    expect(screen.getByDisplayValue("OpenAI")).toBeInTheDocument()
    expect(
      screen.getByDisplayValue("https://api.openai.com/v1")
    ).toBeInTheDocument()
    const submit = screen.getByRole("button", {
      name: "settings.providers.add.submit"
    })
    expect(submit).toBeDisabled()

    fireEvent.change(
      screen.getByLabelText("settings.providers.add.api_key_required_label"),
      { target: { value: "sk-openai-test" } }
    )
    fireEvent.click(submit)

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        wire: "openai",
        apiKey: "sk-openai-test",
        customModels: [],
        serviceProfile: ProviderServiceProfile.OPENAI
      })
    )
  })

  it("allows a keyless generic Anthropic-compatible endpoint", () => {
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={vi.fn()} />
      </TooltipProvider>
    )
    fireEvent.change(
      screen.getByLabelText("settings.providers.add.name_label"),
      { target: { value: "Local Messages" } }
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.providers\.add\.wire_anthropic_compatible/
      })
    )

    expect(
      screen.getByRole("button", { name: "settings.providers.add.submit" })
    ).toBeEnabled()
  })
})
