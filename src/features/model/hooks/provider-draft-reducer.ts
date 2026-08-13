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
}

export const initialProviderDraftState: ProviderDraftState = {
  providers: [],
  loading: true,
  selectedId: DEFAULT_PROVIDER_ID,
  testingConnection: false,
  connectionStatus: null,
  hasUnsavedChanges: false,
  savedRevision: 0
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
  | {
      type: "provider-enabled-optimistically"
      providerId: string
      enabled: boolean
    }
  | {
      type: "provider-enabled-reverted"
      providerId: string
      enabled: boolean
    }
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
      return { ...state, providers: action.providers }
    case "load-finished":
      return { ...state, loading: false }
    case "provider-selected":
      return {
        ...state,
        selectedId: action.providerId,
        connectionStatus: null,
        hasUnsavedChanges: false
      }
    case "draft-updated": {
      const { apiKey, ...configUpdates } = action.updates
      return {
        ...state,
        providers: updateProvider(
          state.providers,
          action.providerId,
          (provider) => ({
            ...provider,
            ...configUpdates,
            ...(Object.hasOwn(action.updates, "apiKey")
              ? {
                  apiKey: apiKey
                    ? { state: "replaced", value: apiKey }
                    : { state: "cleared" }
                }
              : {})
          })
        ),
        hasUnsavedChanges: true,
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
        hasUnsavedChanges: false,
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
        ...(removedSelected
          ? {
              selectedId: DEFAULT_PROVIDER_ID,
              connectionStatus: null,
              hasUnsavedChanges: false
            }
          : {}),
        savedRevision: state.savedRevision + 1
      }
    }
    case "provider-enabled-optimistically":
    case "provider-enabled-reverted":
      return {
        ...state,
        providers: updateProvider(
          state.providers,
          action.providerId,
          (provider) => ({ ...provider, enabled: action.enabled })
        )
      }
    case "connection-test-started":
      return { ...state, testingConnection: true, connectionStatus: null }
    case "connection-test-finished":
      return { ...state, testingConnection: false }
    case "connection-status-set":
      return { ...state, connectionStatus: action.status }
  }
}
