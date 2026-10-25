import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  observeBrowserModelStatus,
  invalidateBrowserModelStatus
} from "@/features/model/lib/browser-model-observer"
import {
  promptAPI,
  createPromptSession,
  TEXT_OPTIONS,
  type Availability
} from "@/lib/providers/browser-built-in/api"
import { ProviderId } from "@/lib/providers/types"
import { queryKeys } from "@/lib/query-keys"
import { extensionRpcClient } from "@/protocol/extension-client"

/** Explicit opt-in; preparation owns activation, while inference stays in the host. */
const AvailableBrowserBuiltInCard = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [availability, setAvailability] = useState<Availability>("unavailable")
  const [enabled, setEnabled] = useState(false)
  const [seenSupport, setSeenSupport] = useState(false)
  const [phase, setPhase] = useState<"preparing" | "saving" | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const operation = useRef<AbortController | null>(null)
  const revision = useRef(0)
  const visible = useRef(false)
  const busy = phase !== null

  useEffect(() => {
    visible.current = true
    const unsubscribe = observeBrowserModelStatus((status) => {
      if (!operation.current) {
        setAvailability(status.availability)
        setEnabled(status.enabled)
        if (status.availability !== "unavailable") setSeenSupport(true)
      }
    })
    return () => {
      visible.current = false
      revision.current += 1
      operation.current?.abort()
      unsubscribe()
    }
  }, [])

  if (
    !promptAPI() ||
    (availability === "unavailable" && !seenSupport && !enabled)
  )
    return null

  const changeEnabled = async (nextEnabled: boolean) => {
    if (operation.current) return
    const controller = new AbortController()
    invalidateBrowserModelStatus()
    operation.current = controller
    const actionRevision = ++revision.current
    const current = () => visible.current && revision.current === actionRevision
    setPhase(nextEnabled ? "preparing" : "saving")
    setFailed(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (nextEnabled) {
        const api = promptAPI()
        if (
          !api ||
          (availability !== "available" && !navigator.userActivation?.isActive)
        )
          throw new Error("User activation required")
        timer = setTimeout(() => {
          if (current()) setFailed(true)
          controller.abort()
        }, 30 * 60_000)
        // No await before create: activation belongs to this click and this document.
        const session = await createPromptSession({
          ...TEXT_OPTIONS,
          signal: controller.signal,
          monitor: (monitor) =>
            monitor.addEventListener("downloadprogress", (event) => {
              const loaded = (event as Event & { loaded?: number }).loaded
              if (
                current() &&
                typeof loaded === "number" &&
                Number.isFinite(loaded)
              ) {
                setProgress(Math.round(Math.max(0, Math.min(1, loaded)) * 100))
                if (loaded < 1) setAvailability("downloading")
              }
            })
        })
        try {
          controller.signal.throwIfAborted()
          if (typeof session.promptStreaming !== "function")
            throw new Error("Unsupported session")
        } finally {
          session.destroy()
        }
        clearTimeout(timer)
        timer = undefined
        controller.signal.throwIfAborted()
        // Host creation is verified again by the command before enabled is saved.
        if (current()) {
          setPhase("saving")
          setAvailability("available")
        }
      }
      controller.signal.throwIfAborted()
      const result = await extensionRpcClient.call(
        RpcMethod.ProvidersSetEnabled,
        {
          providerId: ProviderId.BROWSER,
          enabled: nextEnabled
        },
        { signal: controller.signal }
      )
      if (current()) setEnabled(result.provider.enabled)
    } catch {
      if (current() && !controller.signal.aborted) setFailed(true)
    } finally {
      clearTimeout(timer)
      if (operation.current === controller) operation.current = null
      if (current()) {
        setPhase(null)
        setProgress(null)
      }
      invalidateBrowserModelStatus()
      // Even an interrupted command may already have committed: re-read authoritative state.
      await queryClient
        .invalidateQueries({ queryKey: queryKeys.model.all() })
        .catch(() => undefined)
    }
  }

  const needsDownload =
    availability === "downloadable" || availability === "downloading"
  return (
    <Card data-settings-focus="true" data-settings-focus-id="browser-built-in">
      <CardHeader>
        <CardTitle>{t("settings.providers.browser_builtin.name")}</CardTitle>
        <CardDescription>
          {t("settings.providers.browser_builtin.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <output aria-live="polite" className="text-sm text-muted-foreground">
          {t(
            `settings.providers.browser_builtin.${phase === "preparing" ? "preparing" : availability}`
          )}
          {progress !== null && ` ${progress}%`}
        </output>
        {failed && (
          <p role="alert" className="text-sm text-status-danger">
            {t("settings.providers.browser_builtin.failed")}
          </p>
        )}
        <Button
          variant="outline"
          disabled={busy || (!enabled && availability === "unavailable")}
          onClick={() => void changeEnabled(!enabled)}>
          {t(
            `settings.providers.browser_builtin.${enabled ? "disable" : availability === "available" ? "enable" : "download"}`
          )}
        </Button>
        {enabled && needsDownload && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void changeEnabled(true)}>
            {t("settings.providers.browser_builtin.download")}
          </Button>
        )}
        {phase === "preparing" && (
          <Button variant="ghost" onClick={() => operation.current?.abort()}>
            {t("common.cancel")}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

/** Unsupported browsers never mount hooks or context-dependent model controls. */
export const BrowserBuiltInCard = () =>
  promptAPI() ? <AvailableBrowserBuiltInCard /> : null
