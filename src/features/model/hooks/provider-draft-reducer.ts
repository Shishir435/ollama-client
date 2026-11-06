import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import type {
  ProviderDraft,
  ProviderDraftUpdate
} from "../types/provider-draft"

export interface ProviderConnectionStatus {
  success: boolean
  message: string
}

export interface ProviderDraftState {
  providers: ProviderDraft[]
  loading: boolean
  selectedId: string
  testingConnection: boolean
  connectionStatus: ProviderConnectionStatus | null
  hasUnsavedChanges: boolean
  savedRevision: number
  /** The last stored copy of every provider, so a draft can be discarded. */
  storedProviders: ProviderDraft[]
  /** Outcome of the last explicit save, shown inline beside the Save bar. */
  saveStatus: ProviderSaveStatus
}

export type ProviderSaveStatus = "idle" | "saving" | "saved" | "failed"

export const initialProviderDraftState: ProviderDraftState = {
  providers: [],
  loading: true,
  selectedId: DEFAULT_PROVIDER_ID,
  testingConnection: false,
  connectionStatus: null,
  hasUnsavedChanges: false,
  savedRevision: 0,
  storedProviders: [],
  saveStatus: "idle"
}

export type ProviderDraftAction =
  | { type: "load-started" }
  | { type: "load-succeeded"; providers: ProviderDraft[] }
  | { type: "load-finished" }
  | { type: "provider-selected"; providerId: string }
  | {
      type: "draft-updated"
      providerId: string
      updates: ProviderDraftUpdate
    }
  | { type: "provider-saved"; provider: ProviderDraft }
  | { type: "provider-added"; provider: ProviderDraft }
  | { type: "provider-removed"; providerId: string }
  | { type: "draft-discarded"; providerId: string }
  | { type: "save-started" }
  | { type: "save-failed" }
  | { type: "connection-test-started" }
  | { type: "connection-test-finished" }
  | { type: "connection-status-set"; status: ProviderConnectionStatus | null }

const updateProvider = (
  providers: ProviderDraft[],
  providerId: string,
  update: (provider: ProviderDraft) => ProviderDraft
): ProviderDraft[] =>
  providers.map((provider) =>
    String(provider.id) === providerId ? update(provider) : provider
  )

export const providerDraftReducer = (
  state: ProviderDraftState,
  action: ProviderDraftAction
): ProviderDraftState => {
  switch (action.type) {
    case "load-started":
      return { ...state, loading: true }
    case "load-succeeded":
      return {
        ...state,
        providers: action.providers,
        storedProviders: action.providers
      }
    case "load-finished":
      return { ...state, loading: false }
    case "provider-selected":
      return {
        ...state,
        selectedId: action.providerId,
        connectionStatus: null,
        hasUnsavedChanges: false,
        saveStatus: "idle"
      }
    case "draft-updated": {
      const { apiKey, clearApiKey, ...configUpdates } = action.updates
      return {
        ...state,
        providers: updateProvider(
          state.providers,
          action.providerId,
          (provider) => ({
            ...provider,
            ...configUpdates,
            ...(clearApiKey
              ? { apiKey: { state: "cleared" as const } }
              : Object.hasOwn(action.updates, "apiKey")
                ? {
                    /**
                     * Emptying the field reverts to the stored key; only an
                     * explicit `clearApiKey` deletes it.
                     */
                    apiKey: apiKey
                      ? { state: "replaced" as const, value: apiKey }
                      : { state: "unchanged" as const }
                  }
                : {})
          })
        ),
        hasUnsavedChanges: true,
        saveStatus: "idle",
        connectionStatus: null
      }
    }
    case "provider-saved":
      return {
        ...state,
        providers: updateProvider(
          state.providers,
          String(action.provider.id),
          () => action.provider
        ),
        storedProviders: updateProvider(
          state.storedProviders,
          String(action.provider.id),
          () => action.provider
        ),
        hasUnsavedChanges: false,
        saveStatus: "saved",
        savedRevision: state.savedRevision + 1
      }
    case "provider-added":
      return {
        ...state,
        providers: [
          ...state.providers.filter(
            (provider) => provider.id !== action.provider.id
          ),
          action.provider
        ],
        storedProviders: [
          ...state.storedProviders.filter(
            (provider) => provider.id !== action.provider.id
          ),
          action.provider
        ],
        saveStatus: "idle",
        selectedId: String(action.provider.id),
        connectionStatus: null,
        hasUnsavedChanges: false,
        savedRevision: state.savedRevision + 1
      }
    case "provider-removed": {
      const removedSelected = state.selectedId === action.providerId
      return {
        ...state,
        providers: state.providers.filter(
          (provider) => String(provider.id) !== action.providerId
        ),
        storedProviders: state.storedProviders.filter(
          (provider) => String(provider.id) !== action.providerId
        ),
        ...(removedSelected
          ? {
              saveStatus: "idle" as const,
              selectedId: DEFAULT_PROVIDER_ID,
              connectionStatus: null,
              hasUnsavedChanges: false
            }
          : {}),
        savedRevision: state.savedRevision + 1
      }
    }
    case "draft-discarded": {
      const stored = state.storedProviders.find(
        (provider) => String(provider.id) === action.providerId
      )
      return {
        ...state,
        providers: stored
          ? updateProvider(state.providers, action.providerId, () => stored)
          : state.providers,
        hasUnsavedChanges: false,
        saveStatus: "idle",
        connectionStatus: null
      }
    }
    case "save-started":
      return { ...state, saveStatus: "saving" }
    case "save-failed":
      return { ...state, saveStatus: "failed" }
    case "connection-test-started":
      return { ...state, testingConnection: true, connectionStatus: null }
    case "connection-test-finished":
      return { ...state, testingConnection: false }
    case "connection-status-set":
      return { ...state, connectionStatus: action.status }
  }
}
