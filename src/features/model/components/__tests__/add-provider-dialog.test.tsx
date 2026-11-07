import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ProviderServiceProfile } from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"
import { AddProviderDialog } from "../add-provider-dialog"

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call: vi.fn() }
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("AddProviderDialog", () => {
  it("does not label the core add flow as beta", () => {
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={vi.fn()} />
      </TooltipProvider>
    )

    expect(screen.queryByText("settings.providers.beta_badge")).toBeNull()
  })

  it("exposes the API types as a radio group with arrow-key selection", () => {
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={vi.fn()} />
      </TooltipProvider>
    )

    const group = screen.getByRole("radiogroup")
    const radios = within(group).getAllByRole("radio")
    expect(radios).toHaveLength(6)
    expect(radios[0]).toHaveAttribute("aria-checked", "true")
    expect(radios[1]).toHaveAttribute("tabindex", "-1")

    fireEvent.keyDown(radios[0], { key: "ArrowRight" })
    expect(radios[1]).toHaveAttribute("aria-checked", "true")
    expect(radios[0]).toHaveAttribute("aria-checked", "false")
  })

  it("asks for a scheme on blur and offers the http:// form", () => {
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={vi.fn()} />
      </TooltipProvider>
    )
    const url = screen.getByLabelText("settings.providers.base_url")
    fireEvent.change(url, { target: { value: "localhost:1234" } })
    expect(
      screen.queryByText("settings.providers.add.url_scheme_missing")
    ).toBeNull()

    fireEvent.blur(url)
    expect(
      screen.getByText("settings.providers.add.url_scheme_missing", {
        exact: false
      })
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.providers.add.url_use_suggestion"
      })
    )
    expect(
      screen.getByDisplayValue("http://localhost:1234")
    ).toBeInTheDocument()
  })

  it("calls a LAN address a local network, and a public host remote", () => {
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={vi.fn()} />
      </TooltipProvider>
    )
    const url = screen.getByLabelText("settings.providers.base_url")

    fireEvent.change(url, { target: { value: "http://192.168.1.5:1234/v1" } })
    expect(
      screen.getByText("settings.providers.add.local_network_notice")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("settings.providers.add.remote_notice")
    ).toBeNull()

    fireEvent.change(url, { target: { value: "http://nas.local:8080/v1" } })
    expect(
      screen.getByText("settings.providers.add.local_network_notice")
    ).toBeInTheDocument()

    fireEvent.change(url, { target: { value: "https://api.example.com/v1" } })
    expect(
      screen.getByText("settings.providers.add.remote_notice")
    ).toBeInTheDocument()
  })

  it("tests the connection before adding, without persisting anything", async () => {
    vi.mocked(extensionRpcClient.call).mockResolvedValue({
      modelCount: 3
    } as never)
    const onAdd = vi.fn()
    render(
      <TooltipProvider>
        <AddProviderDialog open onOpenChange={vi.fn()} onAdd={onAdd} />
      </TooltipProvider>
    )
    fireEvent.change(
      screen.getByLabelText("settings.providers.add.name_label"),
      { target: { value: "Home" } }
    )
    fireEvent.click(
      screen.getByRole("button", { name: "settings.providers.add.test" })
    )

    expect(
      await screen.findByText("settings.providers.add.test_ok")
    ).toBeInTheDocument()
    expect(extensionRpcClient.call).toHaveBeenCalledWith(
      RpcMethod.ProvidersTestConnection,
      expect.objectContaining({
        target: "draft",
        config: expect.objectContaining({
          baseUrl: "http://localhost:8080/v1",
          apiKey: { state: "cleared" }
        })
      })
    )
    expect(onAdd).not.toHaveBeenCalled()
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
      screen.getByRole("radio", {
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
      screen.getByRole("radio", {
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
      screen.getByRole("radio", {
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
      screen.getByRole("radio", {
        name: /settings\.providers\.add\.wire_anthropic_compatible/
      })
    )

    expect(
      screen.getByRole("button", { name: "settings.providers.add.submit" })
    ).toBeEnabled()
  })
})
