import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  ArrowLeft,
  Bot,
  CircleCheck,
  Globe,
  Loader2,
  Server,
  ShieldCheck,
  TriangleAlert
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { usePendingChatSend } from "@/features/chat/stores/chat-input-store"
import {
  AddProviderDialog,
  type AddProviderDialogProps
} from "@/features/model/components/add-provider-dialog"
import { ModelPullInline } from "@/features/model/components/model-pull-inline"
import { OllamaOriginsCommand } from "@/features/model/components/ollama-origins-command"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useToast } from "@/hooks/use-toast"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { isLikelyEmbeddingModelName } from "@/lib/embeddings/model-name-filter"
import { isOriginsFixMessageKey } from "@/lib/onboarding/provider-connection"
import {
  getOnboardingState,
  type OnboardingStage,
  selectOnboardingModel,
  selectOnboardingProvider,
  skipOnboarding,
  updateOnboardingState
} from "@/lib/onboarding/state"
import {
  classifyEndpointScope,
  type EndpointScope
} from "@/lib/providers/endpoint-scope"
import { saveSelectedModelRef } from "@/lib/providers/selected-model"
import { extensionRpcClient } from "@/protocol/extension-client"

const STAGES: OnboardingStage[] = [
  "privacy",
  "provider-choice",
  "provider-connection",
  "model-choice",
  "test-chat"
]

/**
 * The stages one run actually shows. A working local Ollama with a model is
 * finished from the first screen in one click, so the run is that screen alone
 * and carries no step counter; choosing another model or provider is the full
 * flow, counted as such.
 */
export const onboardingStagesFor = (
  autoDetected: boolean
): OnboardingStage[] => (autoDetected ? ["privacy"] : STAGES)

const providerScope = (provider?: PublicProviderConfig) =>
  classifyEndpointScope(provider?.baseUrl ?? "")

const destinationLabel = {
  loopback: "onboarding.provider.local",
  "local-network": "onboarding.provider.local_network",
  remote: "onboarding.provider.remote",
  invalid: "settings.providers.add.url_invalid"
} satisfies Record<EndpointScope, string>

const ProviderDestination = ({
  provider
}: {
  provider: PublicProviderConfig
}) => {
  const { t } = useTranslation()
  const scope = providerScope(provider)
  return (
    <span className="block break-all text-micro text-muted-foreground">
      {t(destinationLabel[scope])}
      {scope !== "invalid" && provider.baseUrl && (
        <> · {new URL(provider.baseUrl).origin}</>
      )}
      {scope !== "loopback" && provider.hasApiKey && (
        <> · {t("onboarding.provider.key_configured")}</>
      )}
    </span>
  )
}

const chatModelsOnly = (models: ProvidersListModelsResult["models"]) =>
  models.filter((model) => {
    const type = model.capabilityHints?.modelType?.toLowerCase()
    return type !== "embedding" && !isLikelyEmbeddingModelName(model.name)
  })

const modelActionKey = (verified: boolean) =>
  verified ? "onboarding.model.use" : "onboarding.model.use_unverified"

const hasSelectedModel = (
  models: ProvidersListModelsResult["models"],
  providerId: string | undefined,
  modelId: string
) =>
  models.some(
    (model) => model.name === modelId && model.providerId === providerId
  )

const ModelConnectionNotice = ({
  verified,
  failed,
  provider
}: {
  verified: boolean
  failed: boolean
  provider: string
}) => {
  const { t } = useTranslation()
  return (
    <>
      {!verified && (
        <p
          aria-live="polite"
          className="rounded-control bg-tint-warning p-2 text-xs">
          {t("onboarding.provider.unverified")}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          {t("onboarding.provider.connection_failed", { provider })}
        </p>
      )}
    </>
  )
}

/**
 * Onboarding opens on its own, not from a control, so closing it would hand
 * focus back to `<body>` and leave a keyboard user nowhere. The composer is
 * where the next action is; before a chat exists, the panel's first control.
 */
const onboardingFinalFocus = (): HTMLElement | boolean =>
  document.getElementById("chat-input-textarea") ??
  document.querySelector<HTMLElement>(
    "#app button:not([disabled]), #app a[href]"
  ) ??
  true

export const FirstRunPermissionsDialog = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { queueChatSend } = usePendingChatSend()
  const { createSession, setCurrentSessionId } = useChatSessions(false)
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<OnboardingStage>("privacy")
  const [providers, setProviders] = useState<PublicProviderConfig[]>([])
  const [providerId, setProviderId] = useState<string>()
  const [models, setModels] = useState<ProvidersListModelsResult["models"]>([])
  const [modelId, setModelId] = useState("")
  const [testSessionId, setTestSessionId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [connectionVerified, setConnectionVerified] = useState(false)
  const [addProviderOpen, setAddProviderOpen] = useState(false)
  const [errorSupportCode, setErrorSupportCode] = useState<string>()
  const [connectionError, setConnectionError] = useState<{
    messageKey?: string
    messageParams?: Record<string, string | number | boolean>
    fallback: string
  }>()
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  /**
   * A local Ollama that answered with at least one chat model on first open.
   * Only found from a fresh start; a resumed run keeps the stage it was on.
   */
  const [detected, setDetected] = useState<{
    providerId: string
    models: ProvidersListModelsResult["models"]
  } | null>(null)
  const [chooseManually, setChooseManually] = useState(false)
  /**
   * Bumped when the user dismisses the dialog. A load still in flight belongs
   * to the generation it started in, so its late failure cannot reopen a
   * dialog the user already closed.
   */
  const loadGeneration = useRef(0)
  /**
   * Set once the user moves off the first screen. Detection that answers
   * after that would swap the flow they are in for the one-screen shortcut.
   */
  const navigated = useRef(false)
  const stages = onboardingStagesFor(Boolean(detected) && !chooseManually)
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === providerId),
    [providerId, providers]
  )
  const providerName = selectedProvider?.name ?? providerId ?? ""
  const selectedScope = providerScope(selectedProvider)
  const detectedProvider = providers.find(
    (provider) => provider.id === detected?.providerId
  )

  const detectOllama = useCallback(
    async (list: PublicProviderConfig[], isActive: () => boolean) => {
      const loopbackOllamas = list.filter(
        (provider) =>
          provider.type === "ollama" && providerScope(provider) === "loopback"
      )
      const ollama =
        loopbackOllamas.find(
          (provider) => provider.id === DEFAULT_PROVIDER_ID
        ) ?? loopbackOllamas[0]
      if (!ollama) return
      try {
        const verdict = await extensionRpcClient.call(
          RpcMethod.ProvidersTestConnection,
          { target: "stored", providerId: ollama.id }
        )
        if (!verdict.reachable || !isActive()) return
        const result = await extensionRpcClient.call(
          RpcMethod.ProvidersListModels,
          { providerId: ollama.id }
        )
        const available = chatModelsOnly(result.models)
        if (available.length > 0 && isActive()) {
          setDetected({ providerId: ollama.id, models: available })
        }
      } catch {
        /** A server that is not there is the normal path; the connection step explains it. */
      }
    },
    []
  )

  useEffect(() => {
    let active = true
    const generation = loadGeneration.current
    const isActive = () => active && generation === loadGeneration.current
    const load = async () => {
      try {
        const state = await getOnboardingState()
        if (!isActive()) return
        setLoadError(false)
        setProviderId(state.providerId)
        setModelId(state.modelRef?.modelId ?? "")
        setTestSessionId(state.testSessionId)
        setStage(state.stage)
        if (state.stage === "complete") return
        setOpen(true)
        const result = await extensionRpcClient.call(
          RpcMethod.ProvidersList,
          {}
        )
        if (!isActive()) return
        setProviders(result.providers)
        const savedProvider = result.providers.find(
          (provider) => provider.id === state.providerId
        )
        if (
          state.stage === "model-choice" &&
          savedProvider &&
          providerScope(savedProvider) === "loopback"
        ) {
          const modelResult = await extensionRpcClient.call(
            RpcMethod.ProvidersListModels,
            { providerId: savedProvider.id }
          )
          if (isActive()) setModels(chatModelsOnly(modelResult.models))
        }
        if (state.stage === "privacy" && !state.providerId) {
          await detectOllama(
            result.providers,
            () => isActive() && !navigated.current
          )
        }
      } catch {
        if (isActive()) {
          setOpen(true)
          setLoadError(true)
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [detectOllama, loadAttempt])

  const persistStage = async (next: OnboardingStage) => {
    navigated.current = true
    setStage(next)
    await updateOnboardingState({ stage: next })
  }

  const chooseProvider = async (chosen: PublicProviderConfig) => {
    const { id } = chosen
    navigated.current = true
    setProviderId(id)
    setModelId("")
    setModels([])
    setConnectionVerified(false)
    setErrorSupportCode(undefined)
    setConnectionError(undefined)
    await selectOnboardingProvider(id)
    setStage("provider-connection")
    if (providerScope(chosen) === "loopback") void testConnection(id)
  }

  const testConnection = async (targetId = providerId) => {
    const target = targetId
    if (!target) return
    setBusy(true)
    setConnectionVerified(false)
    setErrorSupportCode(undefined)
    setConnectionError(undefined)
    try {
      const verdict = await extensionRpcClient.call(
        RpcMethod.ProvidersTestConnection,
        {
          target: "stored",
          providerId: target
        }
      )
      const result = await extensionRpcClient.call(
        RpcMethod.ProvidersListModels,
        { providerId: target }
      )
      const available = chatModelsOnly(result.models)
      setModels(available)
      setModelId((current) =>
        available.some((model) => model.name === current)
          ? current
          : verdict.reachable
            ? (available[0]?.name ?? "")
            : ""
      )
      setConnectionVerified(verdict.reachable)
      await persistStage("model-choice")
    } catch (error) {
      setModels([])
      setModelId("")
      const safeError = error as {
        messageKey?: string
        messageParams?: Record<string, string | number | boolean>
        userMessage?: string
        context?: unknown
      }
      setErrorSupportCode(
        safeError.context
          ? String(safeError.context)
          : "OLC-PROVIDER-CONNECTION-001"
      )
      setConnectionError({
        messageKey: safeError.messageKey,
        messageParams: safeError.messageParams,
        fallback:
          safeError.userMessage ??
          t("onboarding.provider.connection_failed", { provider: providerName })
      })
    } finally {
      setBusy(false)
    }
  }

  /** Make this the chat model: enable its provider, then record the choice. */
  const commitModel = async (
    targetProviderId: string,
    targetModelId: string
  ) => {
    await extensionRpcClient.call(RpcMethod.ProvidersSetEnabled, {
      providerId: targetProviderId,
      enabled: true
    })
    const ref = { providerId: targetProviderId, modelId: targetModelId }
    await saveSelectedModelRef(ref)
    await selectOnboardingModel(ref)
  }

  const chooseModel = async () => {
    if (busy || !providerId || !hasSelectedModel(models, providerId, modelId))
      return
    setBusy(true)
    try {
      await commitModel(providerId, modelId)
      setStage("test-chat")
    } catch {
      toast({
        variant: "destructive",
        title: t("onboarding.model.use_failed")
      })
    } finally {
      setBusy(false)
    }
  }

  const openTestChat = async () => {
    let sessionId = testSessionId
    if (sessionId) {
      setCurrentSessionId(sessionId)
    } else {
      sessionId = await createSession()
      setTestSessionId(sessionId)
      await updateOnboardingState({ testSessionId: sessionId })
    }
    queueChatSend(t("onboarding.test_chat.prompt"))
    loadGeneration.current += 1
    setOpen(false)
  }

  /**
   * The one-click path for a detected Ollama: record it and its first model
   * as the choice, then open the test chat — the same writes the step-by-step
   * flow makes, in one gesture.
   */
  const startWithDetected = async () => {
    const first = detected?.models[0]
    if (busy || !detected || !first) return
    setBusy(true)
    try {
      await selectOnboardingProvider(detected.providerId)
      await commitModel(detected.providerId, first.name)
      setProviderId(detected.providerId)
      setModelId(first.name)
      await openTestChat()
    } catch {
      toast({
        variant: "destructive",
        title: t("onboarding.model.use_failed")
      })
    } finally {
      setBusy(false)
    }
  }

  const openProviderSetup = () => {
    void openOptionsInTab(
      runtime.getURL("options.html?tab=models&focus=provider-settings")
    )
  }

  const addProvider: AddProviderDialogProps["onAdd"] = async (provider) => {
    try {
      const result = await extensionRpcClient.call(RpcMethod.ProvidersUpsert, {
        target: "new",
        provider
      })
      setProviders((current) => [...current, result.provider])
      await chooseProvider(result.provider)
      return true
    } catch (error) {
      const safeError = error as { userMessage?: string; context?: unknown }
      const supportCode = safeError.context
        ? String(safeError.context)
        : "OLC-PROVIDER-CONNECTION-001"
      setErrorSupportCode(supportCode)
      toast({
        title: t("settings.providers.add.failed_title"),
        description: `${safeError.userMessage ?? t("errors.rpc.provider_failed")} ${t("onboarding.provider.support_code")}: ${supportCode}`,
        variant: "destructive"
      })
      return false
    }
  }

  const goBack = async () => {
    const index = stages.indexOf(stage)
    const next = stages[Math.max(0, index - 1)]
    await persistStage(next)
  }

  const stepIndex = Math.max(1, stages.indexOf(stage) + 1)
  const Icon =
    stage === "privacy"
      ? ShieldCheck
      : stage === "provider-choice"
        ? Bot
        : stage === "provider-connection"
          ? Server
          : CircleCheck

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            /**
             * Closing is a decision, not a postponement: without recording it
             * the dialog came back on every panel open. A close that lands
             * while a step is working or the nested add-provider dialog is up
             * is not one.
             */
            if (busy || addProviderOpen) return
            loadGeneration.current += 1
            void skipOnboarding()
          }
          setOpen(next)
        }}>
        <DialogContent finalFocus={onboardingFinalFocus}>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-control bg-app-primary-soft text-app-agent">
                <Icon className="icon-md" />
              </div>
              <div className="flex items-center gap-2">
                {stages.length > 1 && (
                  <span className="text-xs text-muted-foreground">
                    {t("onboarding.step", {
                      current: stepIndex,
                      total: stages.length
                    })}
                  </span>
                )}
                {/* Skipping is offered in the same place on every stage, away
                    from the stage's own buttons, so it is never the fourth
                    button in a crowded footer. */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    loadGeneration.current += 1
                    void skipOnboarding()
                    setOpen(false)
                  }}>
                  {t("onboarding.provider.skip")}
                </Button>
              </div>
            </div>

            {loadError && (
              <div
                role="alert"
                className="space-y-2 rounded-control bg-tint-danger p-2 text-xs text-destructive">
                <div className="flex gap-2">
                  <TriangleAlert className="icon-sm shrink-0" />
                  {t("onboarding.load_error.message")}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                  {t("common.actions.retry")}
                </Button>
              </div>
            )}

            {stage === "privacy" && (
              <>
                <DialogTitle>{t("onboarding.privacy.title")}</DialogTitle>
                <DialogDescription>
                  {t("onboarding.privacy.description")}
                </DialogDescription>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>{t("onboarding.privacy.local_storage")}</li>
                  <li>{t("onboarding.privacy.no_telemetry")}</li>
                  <li>{t("onboarding.privacy.remote_policy")}</li>
                  <li>{t("onboarding.privacy.permissions_jit")}</li>
                </ul>
                {detectedProvider && !chooseManually && (
                  <div
                    aria-live="polite"
                    className="rounded-control bg-tint-success p-2 text-xs">
                    {t("onboarding.auto.detected", {
                      provider: detectedProvider.name
                    })}
                    <ProviderDestination provider={detectedProvider} />
                  </div>
                )}
              </>
            )}

            {stage === "provider-choice" && (
              <>
                <DialogTitle>
                  {t("onboarding.provider.choose_title")}
                </DialogTitle>
                <DialogDescription>
                  {t("onboarding.provider.choose_description")}
                </DialogDescription>
                <div className="@container">
                  <div className="grid max-h-72 gap-2 overflow-y-auto pt-2 @sm:grid-cols-2">
                    {providers.map((provider) => {
                      const ProviderIcon =
                        providerScope(provider) === "remote" ? Globe : Server
                      return (
                        <button
                          type="button"
                          key={provider.id}
                          className="rounded-control border p-3 text-left hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => void chooseProvider(provider)}>
                          <div className="flex items-center gap-2 font-medium">
                            <ProviderIcon className="icon-sm" />
                            {provider.name}
                          </div>
                          <ProviderDestination provider={provider} />
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      className="rounded-control border border-dashed border-stroke-control p-3 text-left hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setAddProviderOpen(true)}>
                      <div className="flex items-center gap-2 font-medium">
                        <Globe className="icon-sm" />
                        {t("settings.providers.add.title")}
                      </div>
                      <div className="mt-1 text-micro text-muted-foreground">
                        {t("settings.providers.add.description")}
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}

            {stage === "provider-connection" && (
              <>
                <DialogTitle>
                  {t("onboarding.provider.connect_title")}
                </DialogTitle>
                <DialogDescription>
                  {t("onboarding.provider.connect_description", {
                    provider: selectedProvider?.name ?? providerId
                  })}
                </DialogDescription>
                {selectedProvider && (
                  <ProviderDestination provider={selectedProvider} />
                )}
                {(selectedScope === "remote" ||
                  selectedScope === "local-network") && (
                  <div className="rounded-control bg-tint-warning p-2 text-xs text-foreground">
                    {t(
                      selectedScope === "remote"
                        ? "onboarding.provider.remote_disclosure"
                        : "onboarding.provider.local_network_disclosure"
                    )}
                  </div>
                )}
                {errorSupportCode && (
                  <div
                    role="alert"
                    className="space-y-1 rounded-control bg-tint-danger p-2 text-xs text-destructive">
                    <div className="flex gap-2">
                      <TriangleAlert className="icon-sm shrink-0" />
                      {connectionError?.messageKey
                        ? t(connectionError.messageKey, {
                            provider: providerName,
                            ...connectionError.messageParams
                          })
                        : (connectionError?.fallback ??
                          t("onboarding.provider.connection_failed", {
                            provider: providerName
                          }))}
                    </div>
                    {isOriginsFixMessageKey(connectionError?.messageKey) && (
                      <OllamaOriginsCommand />
                    )}
                    <div>
                      {t("onboarding.provider.support_code")}:{" "}
                      <code className="select-all">{errorSupportCode}</code>
                    </div>
                  </div>
                )}
              </>
            )}

            {stage === "model-choice" && (
              <>
                <DialogTitle>{t("onboarding.model.title")}</DialogTitle>
                <DialogDescription>
                  {t("onboarding.model.description")}
                </DialogDescription>
                {selectedProvider && (
                  <ProviderDestination provider={selectedProvider} />
                )}
                <ModelConnectionNotice
                  verified={connectionVerified}
                  failed={Boolean(errorSupportCode)}
                  provider={providerName}
                />
                {models.length === 0 ? (
                  <div className="space-y-3 rounded-control bg-tint-warning p-2 text-xs">
                    <p>
                      {connectionVerified
                        ? t(
                            selectedProvider?.type === "ollama"
                              ? "onboarding.model.none_pull"
                              : "onboarding.model.none",
                            { provider: providerName }
                          )
                        : t("onboarding.model.none_unverified")}
                    </p>
                    {connectionVerified &&
                      selectedProvider?.type === "ollama" && (
                        <ModelPullInline
                          providerId={selectedProvider.id}
                          onPulled={(_model, pulledProviderId) => {
                            if (pulledProviderId === providerId) {
                              void testConnection(pulledProviderId)
                            }
                          }}
                        />
                      )}
                  </div>
                ) : (
                  <Select
                    value={modelId}
                    onValueChange={(value) => setModelId(value ?? "")}>
                    <SelectTrigger
                      className="w-full"
                      aria-label={t("onboarding.model.title")}>
                      <SelectValue
                        placeholder={t("onboarding.model.placeholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((model) => (
                        <SelectItem
                          key={`${model.providerId}:${model.name}`}
                          value={model.name}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </>
            )}

            {stage === "test-chat" && (
              <>
                <DialogTitle>{t("onboarding.test_chat.title")}</DialogTitle>
                <DialogDescription>
                  {t("onboarding.test_chat.description")}
                </DialogDescription>
                <div className="select-all rounded-control bg-muted p-3 text-xs">
                  {t("onboarding.test_chat.prompt")}
                </div>
                {selectedProvider && (
                  <ProviderDestination provider={selectedProvider} />
                )}
                {(selectedScope === "remote" ||
                  selectedScope === "local-network") && (
                  <div className="rounded-control bg-tint-warning p-2 text-xs">
                    {t(
                      selectedScope === "remote"
                        ? "onboarding.test_chat.cost"
                        : "settings.providers.add.local_network_notice"
                    )}
                  </div>
                )}
              </>
            )}
          </DialogHeader>

          <DialogFooter>
            {stage !== "privacy" && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void goBack()}>
                <ArrowLeft className="icon-sm" />
                {t("common.actions.back")}
              </Button>
            )}
            {stage === "privacy" && detected && !chooseManually && (
              <>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setChooseManually(true)
                    void persistStage("provider-choice")
                  }}>
                  {t("onboarding.auto.choose_other")}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void startWithDetected()}>
                  {busy && <Loader2 className="icon-sm animate-spin" />}
                  {t("onboarding.auto.start", {
                    model: detected.models[0]?.name ?? ""
                  })}
                </Button>
              </>
            )}
            {stage === "privacy" && !(detected && !chooseManually) && (
              <Button onClick={() => void persistStage("provider-choice")}>
                {t("onboarding.continue")}
              </Button>
            )}
            {stage === "provider-connection" && (
              <>
                <Button variant="ghost" onClick={openProviderSetup}>
                  {t("onboarding.provider.open_setup")}
                </Button>
                <Button
                  disabled={busy || selectedScope === "invalid"}
                  onClick={() => void testConnection()}>
                  {busy && <Loader2 className="icon-sm animate-spin" />}
                  {t(
                    errorSupportCode
                      ? "onboarding.provider.recheck"
                      : "settings.providers.test"
                  )}
                </Button>
              </>
            )}
            {stage === "model-choice" && (
              <>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={openProviderSetup}>
                  {t("onboarding.provider.open_setup")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || selectedScope === "invalid"}
                  onClick={() => void testConnection()}>
                  {t("onboarding.model.refresh")}
                </Button>
                <Button
                  disabled={
                    busy || !hasSelectedModel(models, providerId, modelId)
                  }
                  onClick={() => void chooseModel()}>
                  {t(modelActionKey(connectionVerified))}
                </Button>
              </>
            )}
            {stage === "test-chat" && (
              <Button onClick={() => void openTestChat()}>
                {t("onboarding.test_chat.open_chat")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddProviderDialog
        open={addProviderOpen}
        onOpenChange={setAddProviderOpen}
        onAdd={addProvider}
      />
    </>
  )
}

import type {
  ProvidersListModelsResult,
  PublicProviderConfig
} from "@ollama-client/contracts/provider-rpc"
