import { describe, expect, it } from "vitest"
import { ProviderId, ProviderType } from "@/lib/providers/types"
import { deriveProviderSettingsView } from "../provider-settings-view"

const provider = {
  id: ProviderId.OLLAMA,
  name: "Ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  baseUrl: "http://localhost:11434",
  hasApiKey: false,
  apiKey: { state: "unchanged" as const }
}

const derive = (
  overrides: Partial<Parameters<typeof deriveProviderSettingsView>[0]> = {}
) =>
  deriveProviderSettingsView({
    providers: [provider],
    selectedId: ProviderId.OLLAMA,
    connectionStatus: null,
    providerHealth: {},
    defaultUrl: "default",
    ...overrides
  })

describe("deriveProviderSettingsView", () => {
  it("prioritizes inactive and manual-model statuses", () => {
    expect(
      derive({ providers: [{ ...provider, enabled: false }] }).headerStatus
        .label
    ).toBe("inactive")
    expect(
      derive({
        providerHealth: {
          [ProviderId.OLLAMA]: {
            success: true,
            modelListSupported: false
          }
        }
      }).headerStatus.label
    ).toBe("manual_models")
  })

  it("lets an explicit connection result override background health", () => {
    expect(
      derive({
        connectionStatus: { success: false, message: "failed" },
        providerHealth: { [ProviderId.OLLAMA]: { success: true } }
      }).headerStatus.label
    ).toBe("connection_failed")
  })

  it("derives endpoint flags while suppressing hints for invalid URLs", () => {
    const result = derive({
      providers: [{ ...provider, baseUrl: "not a url" }]
    })
    expect(result.cspCompatibilityHint).toBeNull()
    expect(result.isRemoteEndpoint).toBe(true)
  })
})
