import { MODEL_DISCOVERY_FAILURE } from "@ollama-client/contracts/provider-rpc"
import { useTranslation } from "react-i18next"
import { getProviderDisplayName } from "@/lib/providers/registry"
import { useEmbeddingStatus } from "./use-embedding-status"
import { type ProviderCatalog, useProviderModels } from "./use-provider-models"

/**
 * How a status dot reads. `neutral` is "not answered yet": a check still in
 * flight is never shown as healthy, because a guessed green is what makes a
 * broken setup look trustworthy.
 */
export type HealthTone = "danger" | "warning" | "neutral" | "success"

export const HEALTH_DOT_CLASS: Record<HealthTone, string> = {
  danger: "bg-status-danger",
  warning: "bg-status-warning",
  neutral: "bg-muted-foreground",
  success: "bg-status-success"
}

/** The tone a summary shows: the worst of what it summarizes. */
export const worstHealthTone = (tones: HealthTone[]): HealthTone =>
  (["danger", "warning", "neutral", "success"] as const).find((tone) =>
    tones.includes(tone)
  ) ?? "success"

/**
 * What is known about the selected chat model, judged only from its own
 * provider's catalog. Another provider's answer — a failure or a list that
 * happens to carry the same name — never decides it.
 */
type ChatIssue =
  | "ready"
  | "checking"
  | "unverified"
  | "no_model"
  | "empty"
  | "error"
  | "provider_disabled"
  | "unreachable"
  | "catalog_unavailable"
  | "provider_empty"
  | "model_missing"

const CHAT_ISSUE_TONE: Record<ChatIssue, HealthTone> = {
  ready: "success",
  checking: "neutral",
  unverified: "neutral",
  no_model: "neutral",
  empty: "warning",
  error: "warning",
  provider_disabled: "warning",
  unreachable: "danger",
  catalog_unavailable: "warning",
  provider_empty: "warning",
  model_missing: "warning"
}

/** Issues a fresh read of the selected provider's catalog can change. */
const RETRYABLE_CHAT_ISSUES = new Set<ChatIssue>([
  "unverified",
  "unreachable",
  "catalog_unavailable",
  "provider_empty",
  "model_missing"
])

const selectedModelIssue = (
  catalog: ProviderCatalog,
  modelId: string
): ChatIssue => {
  const { state } = catalog
  if (state.status === "checking") return "checking"
  if (state.status === "unverified") return "unverified"
  if (state.status === "request_failed") return "unreachable"
  if (state.failureCode === MODEL_DISCOVERY_FAILURE.REQUEST_FAILED)
    return "unreachable"
  if (state.failureCode === MODEL_DISCOVERY_FAILURE.DISCOVERY_UNAVAILABLE)
    return "catalog_unavailable"
  if (
    state.failureCode === MODEL_DISCOVERY_FAILURE.MODEL_LIST_UNSUPPORTED ||
    state.modelNames.size === 0
  )
    return "provider_empty"
  /*
   * A declared id is listed whether or not the server reported it, so its
   * presence proves nothing; only a model the server itself returned is
   * green, whether or not the user also declared it.
   */
  if (state.discoveredNames.has(modelId)) return "ready"
  return state.modelNames.has(modelId) ? "unverified" : "model_missing"
}

export type ConnectionHealth = ReturnType<typeof useConnectionHealth>

/**
 * The chat provider's and the embedding model's state, read once for the
 * model picker, which is where either is fixed. It replaced a header
 * indicator that reported the same two things one corner away from the
 * control that changes them.
 */
export const useConnectionHealth = () => {
  const { t } = useTranslation()
  const {
    selectedModel,
    selectedModelRef,
    providerCatalogs,
    providersKnown,
    status,
    refreshProvider
  } = useProviderModels()
  const embeddings = useEmbeddingStatus()

  const selectedCatalog = selectedModelRef
    ? providerCatalogs[selectedModelRef.providerId]
    : undefined
  /*
   * Nothing resolved to a provider: no selection at all, or a legacy one the
   * migration could not map. Once discovery has settled that is a settled
   * answer, not a check still running.
   */
  const chatIssue: ChatIssue =
    !selectedModel || !selectedModelRef
      ? status === "loading"
        ? "checking"
        : status === "ready"
          ? "no_model"
          : status === "error"
            ? "error"
            : "empty"
      : !providersKnown
        ? "checking"
        : !selectedCatalog
          ? "provider_disabled"
          : selectedModelIssue(selectedCatalog, selectedModelRef.modelId)
  const providerTone = CHAT_ISSUE_TONE[chatIssue]
  const selectedProviderName = selectedModelRef
    ? (selectedCatalog?.providerName ??
      getProviderDisplayName(selectedModelRef.providerId))
    : ""
  const providerLabel = t(`model.provider_status.${chatIssue}`, {
    provider: selectedProviderName,
    model: selectedModel ?? ""
  })

  /*
   * A rebuild of the index is its own state: search keeps answering from the
   * old index while it runs, and a failed one needs the user, whatever the
   * selected model's reachability says.
   */
  const { nativeState } = embeddings
  const rebuild = nativeState?.failed
    ? "failed"
    : nativeState?.migration === "building"
      ? "building"
      : nativeState?.migration === "changed"
        ? "changed"
        : null
  const embeddingTone: HealthTone = rebuild
    ? "warning"
    : embeddings.loading
      ? "neutral"
      : embeddings.availability === "available"
        ? "success"
        : embeddings.availability === "unverified"
          ? "neutral"
          : "warning"
  const embeddingText =
    rebuild === "failed"
      ? t("settings.embeddings.bundled.error")
      : rebuild === "building"
        ? t("settings.embeddings.bundled.progress", {
            current: nativeState?.current ?? 0,
            total: nativeState?.total ?? 0
          })
        : rebuild === "changed"
          ? t("settings.embeddings.bundled.changed")
          : embeddings.statusText

  const tone = worstHealthTone([providerTone, embeddingTone])
  /** What the trigger's tooltip adds; nothing while both are healthy. */
  const summary = [
    providerTone === "success"
      ? null
      : `${t("chat.connection.provider")}: ${providerLabel}`,
    embeddingTone === "success"
      ? null
      : `${t("chat.connection.embeddings")}: ${embeddingText}`
  ]
    .filter(Boolean)
    .join(" · ")

  return {
    tone,
    providerTone,
    embeddingTone,
    providerLabel,
    /**
     * The selected provider while its catalog has an issue the chat notice
     * reports, so the menu's all-providers notice does not repeat it.
     */
    selectedIssueProviderId:
      selectedModelRef &&
      (providerTone === "danger" || providerTone === "warning")
        ? selectedModelRef.providerId
        : null,
    /** The selected provider never answered, so nothing is known about it. */
    catalogUnverified: selectedCatalog?.state.status === "unverified",
    /** Re-reads only the selected provider's catalog, when that can help. */
    retryProvider:
      selectedModelRef && RETRYABLE_CHAT_ISSUES.has(chatIssue)
        ? () => void refreshProvider(selectedModelRef.providerId)
        : null,
    rebuild,
    embeddingText,
    embeddings,
    summary
  }
}
