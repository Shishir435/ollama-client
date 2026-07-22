import { useEffect, useMemo, useState } from "react"
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
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useToast } from "@/hooks/use-toast"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import {
  ArrowLeft,
  Bot,
  CircleCheck,
  Globe,
  Loader2,
  Server,
  ShieldCheck,
  TriangleAlert
} from "@/lib/lucide-icon"
import {
  getOnboardingState,
  type OnboardingStage,
  selectOnboardingModel,
  selectOnboardingProvider,
  skipOnboarding,
  updateOnboardingState
} from "@/lib/onboarding/state"
import { saveSelectedModelRef } from "@/lib/providers/selected-model"
import { extensionRpcClient } from "@/protocol/extension-client"
import type {
  ProvidersListModelsResult,
  PublicProviderConfig
} from "@/protocol/provider-rpc"
import { RpcMethod } from "@/protocol/rpc"

const STAGES: OnboardingStage[] = [
  "privacy",
  "provider-choice",
  "provider-connection",
  "model-choice",
  "test-chat"
]

const isLocalProvider = (provider: PublicProviderConfig) =>
  provider.type === "ollama" ||
  /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])/i.test(
    provider.baseUrl ?? ""
  )

const chatModelsOnly = (models: ProvidersListModelsResult["models"]) =>
  models.filter((model) => {
    const type = model.capabilityHints?.modelType?.toLowerCase()
    return type !== "embedding" && !/\bembed(ding)?\b/i.test(model.name)
  })

export const FirstRunPermissionsDialog = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { queueChatSend } = usePendingChatSend()
  const { createSession, setCurrentSessionId } = useChatSessions()
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<OnboardingStage>("privacy")
  const [providers, setProviders] = useState<PublicProviderConfig[]>([])
  const [providerId, setProviderId] = useState<string>()
  const [models, setModels] = useState<ProvidersListModelsResult["models"]>([])
  const [modelId, setModelId] = useState("")
  const [testSessionId, setTestSessionId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [addProviderOpen, setAddProviderOpen] = useState(false)
  const [errorSupportCode, setErrorSupportCode] = useState<string>()
  const [connectionError, setConnectionError] = useState<{
    messageKey?: string
    fallback: string
  }>()
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === providerId),
    [providerId, providers]
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const state = await getOnboardingState()
        if (!active) return
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
        if (active) setProviders(result.providers)
        if (state.stage === "model-choice" && state.providerId) {
          const modelResult = await extensionRpcClient.call(
            RpcMethod.ProvidersListModels,
            { providerId: state.providerId }
          )
          if (active) setModels(chatModelsOnly(modelResult.models))
        }
      } catch {
        if (active) setOpen(true)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const persistStage = async (next: OnboardingStage) => {
    setStage(next)
    await updateOnboardingState({ stage: next })
  }

  const chooseProvider = async (id: string) => {
    setProviderId(id)
    setErrorSupportCode(undefined)
    setConnectionError(undefined)
    await selectOnboardingProvider(id)
    setStage("provider-connection")
  }

  const testConnection = async () => {
    if (!providerId) return
    setBusy(true)
    setErrorSupportCode(undefined)
    setConnectionError(undefined)
    try {
      await extensionRpcClient.call(RpcMethod.ProvidersTestConnection, {
        target: "stored",
        providerId
      })
      const result = await extensionRpcClient.call(
        RpcMethod.ProvidersListModels,
        { providerId }
      )
      setModels(chatModelsOnly(result.models))
      await persistStage("model-choice")
    } catch (error) {
      const safeError = error as {
        messageKey?: string
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
        fallback:
          safeError.userMessage ?? t("onboarding.provider.connection_failed")
      })
    } finally {
      setBusy(false)
    }
  }

  const chooseModel = async () => {
    if (!providerId || !modelId) return
    const ref = { providerId, modelId }
    await saveSelectedModelRef(ref)
    await selectOnboardingModel(ref)
    setStage("test-chat")
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
    setOpen(false)
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
      await chooseProvider(result.provider.id)
      return true
    } catch (error) {
      const safeError = error as { userMessage?: string; context?: unknown }
      const supportCode = safeError.context
        ? String(safeError.context)
        : "OLC-PROVIDER-CONNECTION-001"
      setErrorSupportCode(supportCode)
      toast({
        title: t("onboarding.provider.connection_failed"),
        description: `${safeError.userMessage ?? t("errors.rpc.provider_failed")} (${supportCode})`,
        variant: "destructive"
      })
      return false
    }
  }

  const goBack = async () => {
    const index = STAGES.indexOf(stage)
    const next = STAGES[Math.max(0, index - 1)]
    await persistStage(next)
  }

  const stepIndex = Math.max(1, STAGES.indexOf(stage) + 1)
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
          setOpen(next)
        }}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex size-9 items-center justify-center rounded-control bg-app-primary-soft text-app-agent">
                <Icon className="icon-md" />
              </div>
              <span className="text-xs text-muted-foreground">
                {t("onboarding.step", { current: stepIndex, total: 5 })}
              </span>
            </div>

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
                <div className="grid max-h-72 gap-2 overflow-y-auto pt-2 sm:grid-cols-2">
                  {providers.map((provider) => {
                    const local = isLocalProvider(provider)
                    const ProviderIcon = local ? Server : Globe
                    return (
                      <button
                        type="button"
                        key={provider.id}
                        className="rounded-control border p-3 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => void chooseProvider(provider.id)}>
                        <div className="flex items-center gap-2 font-medium">
                          <ProviderIcon className="icon-sm" />
                          {provider.name}
                        </div>
                        <div className="mt-1 text-micro text-muted-foreground">
                          {t(
                            local
                              ? "onboarding.provider.local"
                              : "onboarding.provider.remote"
                          )}
                          {!local && provider.hasApiKey
                            ? ` · ${t("onboarding.provider.key_configured")}`
                            : ""}
                        </div>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className="rounded-control border border-dashed p-3 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
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
                {selectedProvider && !isLocalProvider(selectedProvider) && (
                  <div className="rounded-control bg-warning/10 p-2 text-xs text-warning-foreground">
                    {t("onboarding.provider.remote_disclosure")}
                  </div>
                )}
                {errorSupportCode && (
                  <div className="space-y-1 rounded-control bg-destructive/10 p-2 text-xs text-destructive">
                    <div className="flex gap-2">
                      <TriangleAlert className="icon-sm shrink-0" />
                      {connectionError?.messageKey
                        ? t(connectionError.messageKey)
                        : (connectionError?.fallback ??
                          t("onboarding.provider.connection_failed"))}
                    </div>
                    <code className="select-all">{errorSupportCode}</code>
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
                {models.length === 0 ? (
                  <div className="rounded-control bg-warning/10 p-2 text-xs">
                    {t("onboarding.model.none")}
                  </div>
                ) : (
                  <Select
                    value={modelId}
                    onValueChange={(value) => setModelId(value ?? "")}>
                    <SelectTrigger className="w-full">
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
                {selectedProvider && !isLocalProvider(selectedProvider) && (
                  <div className="rounded-control bg-warning/10 p-2 text-xs">
                    {t("onboarding.test_chat.cost")}
                  </div>
                )}
              </>
            )}
          </DialogHeader>

          <DialogFooter>
            {stage !== "privacy" && (
              <Button variant="ghost" onClick={() => void goBack()}>
                <ArrowLeft className="icon-sm" />
                {t("common.actions.back")}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                void skipOnboarding()
                setOpen(false)
              }}>
              {t("onboarding.provider.skip")}
            </Button>
            {stage === "privacy" && (
              <Button onClick={() => void persistStage("provider-choice")}>
                {t("onboarding.continue")}
              </Button>
            )}
            {stage === "provider-connection" && (
              <>
                <Button variant="ghost" onClick={openProviderSetup}>
                  {t("onboarding.provider.open_setup")}
                </Button>
                <Button disabled={busy} onClick={() => void testConnection()}>
                  {busy && <Loader2 className="icon-sm animate-spin" />}
                  {t("settings.providers.test")}
                </Button>
              </>
            )}
            {stage === "model-choice" && (
              <Button disabled={!modelId} onClick={() => void chooseModel()}>
                {t("onboarding.model.use")}
              </Button>
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
