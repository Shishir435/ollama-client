import { describe, expect, it } from "vitest"
import { ProviderId, ProviderType } from "@/lib/providers/types"
import {
  initialProviderDraftState,
  providerDraftReducer
} from "../provider-draft-reducer"

const ollama = {
  id: ProviderId.OLLAMA,
  name: "Ollama",
  type: ProviderType.OLLAMA,
  enabled: true,
  baseUrl: "http://localhost:11434",
  hasApiKey: false,
  apiKey: { state: "unchanged" as const }
}

describe("providerDraftReducer", () => {
  it("applies credential-safe draft edits and marks them unsaved", () => {
    const state = { ...initialProviderDraftState, providers: [ollama] }
    const replaced = providerDraftReducer(state, {
      type: "draft-updated",
      providerId: ProviderId.OLLAMA,
      updates: { name: "Local", apiKey: "secret" }
    })

    expect(replaced.providers[0]).toMatchObject({
      name: "Local",
      apiKey: { state: "replaced", value: "secret" }
    })
    expect(replaced.hasUnsavedChanges).toBe(true)

    const emptied = providerDraftReducer(replaced, {
      type: "draft-updated",
      providerId: ProviderId.OLLAMA,
      updates: { apiKey: "" }
    })
    expect(emptied.providers[0]?.apiKey).toEqual({ state: "unchanged" })

    const cleared = providerDraftReducer(replaced, {
      type: "draft-updated",
      providerId: ProviderId.OLLAMA,
      updates: { clearApiKey: true }
    })
    expect(cleared.providers[0]?.apiKey).toEqual({ state: "cleared" })
  })

  it("merges authoritative saves and advances stored revision", () => {
    const state = {
      ...initialProviderDraftState,
      providers: [{ ...ollama, name: "Draft" }],
      hasUnsavedChanges: true
    }
    const saved = providerDraftReducer(state, {
      type: "provider-saved",
      provider: { ...ollama, name: "Stored" }
    })

    expect(saved.providers).toEqual([{ ...ollama, name: "Stored" }])
    expect(saved.hasUnsavedChanges).toBe(false)
    expect(saved.savedRevision).toBe(1)
  })

  it("discards a draft back to the last stored copy", () => {
    const loaded = providerDraftReducer(initialProviderDraftState, {
      type: "load-succeeded",
      providers: [ollama]
    })
    const edited = providerDraftReducer(loaded, {
      type: "draft-updated",
      providerId: ProviderId.OLLAMA,
      updates: { baseUrl: "http://localhost:1", enabled: false }
    })
    expect(edited.hasUnsavedChanges).toBe(true)

    const discarded = providerDraftReducer(edited, {
      type: "draft-discarded",
      providerId: ProviderId.OLLAMA
    })
    expect(discarded.providers).toEqual([ollama])
    expect(discarded.hasUnsavedChanges).toBe(false)
  })

  it("tracks the outcome of an explicit save", () => {
    const base = { ...initialProviderDraftState, providers: [ollama] }
    const saving = providerDraftReducer(base, { type: "save-started" })
    expect(saving.saveStatus).toBe("saving")
    expect(
      providerDraftReducer(saving, { type: "save-failed" }).saveStatus
    ).toBe("failed")
    const saved = providerDraftReducer(saving, {
      type: "provider-saved",
      provider: ollama
    })
    expect(saved.saveStatus).toBe("saved")
    expect(
      providerDraftReducer(saved, {
        type: "draft-updated",
        providerId: ProviderId.OLLAMA,
        updates: { name: "x" }
      }).saveStatus
    ).toBe("idle")
  })

  it("preserves another provider's draft when adding or removing", () => {
    const custom = {
      ...ollama,
      id: "custom:openai:test",
      name: "Custom"
    }
    const edited = { ...ollama, baseUrl: "http://localhost:11435" }
    const state = {
      ...initialProviderDraftState,
      providers: [edited],
      hasUnsavedChanges: true
    }
    const added = providerDraftReducer(state, {
      type: "provider-added",
      provider: custom
    })
    const removed = providerDraftReducer(added, {
      type: "provider-removed",
      providerId: custom.id
    })

    expect(added.providers).toEqual([edited, custom])
    expect(removed.providers).toEqual([edited])
    expect(removed.selectedId).toBe(ProviderId.OLLAMA)
  })

  it("resets provider-specific status when selection changes", () => {
    const state = {
      ...initialProviderDraftState,
      connectionStatus: { success: false, message: "failed" },
      hasUnsavedChanges: true
    }
    expect(
      providerDraftReducer(state, {
        type: "provider-selected",
        providerId: "custom:openai:test"
      })
    ).toMatchObject({
      selectedId: "custom:openai:test",
      connectionStatus: null,
      hasUnsavedChanges: false
    })
  })
})
