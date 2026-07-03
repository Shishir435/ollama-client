import { useEffect, useState } from "react"
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
import { Input } from "@/components/ui/input"
import { openOptionsInTab, runtime } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  CircleCheck,
  Loader2,
  Lock,
  Server,
  ShieldCheck,
  TriangleAlert
} from "@/lib/lucide-icon"
import {
  checkProviderConnection,
  OLLAMA_CORS_COMMAND,
  type ProviderConnectionResult
} from "@/lib/onboarding/provider-connection"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderId } from "@/lib/providers/types"

type Step = "privacy" | "provider" | "permissions"

const failureKey = (
  result: Exclude<ProviderConnectionResult, { kind: "connected" }>
): string => `onboarding.provider.errors.${result.kind}`

/**
 * First-run three-beat: local privacy contract, provider connection check, then
 * optional permissions. Provider failures stay in-app and actionable instead
 * of sending a new user straight to external docs.
 */
export const FirstRunPermissionsDialog = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>("privacy")
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434")
  const [checking, setChecking] = useState(false)
  const [connection, setConnection] = useState<ProviderConnectionResult | null>(
    null
  )

  useEffect(() => {
    let active = true
    plasmoGlobalStorage
      .get<boolean>(STORAGE_KEYS.ONBOARDING_PERMISSIONS_SEEN)
      .then((seen) => {
        if (!active) return
        if (!seen) setOpen(true)
      })
      .catch(() => undefined)
    ProviderManager.getProviderConfig(ProviderId.OLLAMA)
      .then((config) => {
        if (active && config?.baseUrl) setBaseUrl(config.baseUrl)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const finish = () => {
    void plasmoGlobalStorage.set(STORAGE_KEYS.ONBOARDING_PERMISSIONS_SEEN, true)
    setOpen(false)
  }

  const testConnection = async () => {
    setChecking(true)
    setConnection(null)
    const current = await ProviderManager.getProviderConfig(ProviderId.OLLAMA)
    if (!current) {
      setConnection({ kind: "unavailable" })
      setChecking(false)
      return
    }
    const result = await checkProviderConnection({
      ...current,
      baseUrl: baseUrl.trim()
    })
    if (result.kind === "connected") {
      await ProviderManager.updateProviderConfig(ProviderId.OLLAMA, {
        baseUrl: baseUrl.trim()
      })
    }
    setConnection(result)
    setChecking(false)
  }

  const openProviderSetup = () => {
    void openOptionsInTab(
      runtime.getURL("options.html?tab=providers&focus=provider-base-url")
    )
  }

  const openPermissions = () => {
    finish()
    void openOptionsInTab(runtime.getURL("options.html?tab=privacy"))
  }

  const stepIndex = step === "privacy" ? 1 : step === "provider" ? 2 : 3
  const Icon =
    step === "privacy" ? ShieldCheck : step === "provider" ? Server : Lock

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish()
      }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex size-9 items-center justify-center rounded-control bg-app-primary-soft text-app-agent">
              <Icon className="icon-md" />
            </div>
            <span className="text-xs text-muted-foreground">
              {t("onboarding.step", { current: stepIndex, total: 3 })}
            </span>
          </div>

          {step === "privacy" && (
            <>
              <DialogTitle>{t("onboarding.permissions.title")}</DialogTitle>
              <DialogDescription>
                {t("onboarding.permissions.privacy")}
              </DialogDescription>
              <DialogDescription>
                {t("onboarding.privacy.host_access")}
              </DialogDescription>
            </>
          )}

          {step === "provider" && (
            <>
              <DialogTitle>{t("onboarding.provider.title")}</DialogTitle>
              <DialogDescription>
                {t("onboarding.provider.description")}
              </DialogDescription>
              <div className="space-y-2 pt-2">
                <label className="text-xs font-medium" htmlFor="onboarding-url">
                  {t("settings.providers.base_url")}
                </label>
                <Input
                  id="onboarding-url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value)
                    setConnection(null)
                  }}
                />
                {connection?.kind === "connected" && (
                  <div className="flex gap-2 rounded-control bg-success/10 p-2 text-xs text-success">
                    <CircleCheck className="icon-sm shrink-0" />
                    <span>
                      {t("onboarding.provider.connected", {
                        count: connection.modelCount
                      })}
                    </span>
                  </div>
                )}
                {connection && connection.kind !== "connected" && (
                  <div className="space-y-2 rounded-control bg-destructive/10 p-2 text-xs text-destructive">
                    <div className="flex gap-2">
                      <TriangleAlert className="icon-sm shrink-0" />
                      <span>{t(failureKey(connection))}</span>
                    </div>
                    {(connection.kind === "cors" ||
                      connection.kind === "unavailable") && (
                      <code className="block select-all overflow-x-auto rounded-control bg-background p-1.5 text-micro text-foreground">
                        {OLLAMA_CORS_COMMAND}
                      </code>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {step === "permissions" && (
            <>
              <DialogTitle>
                {t("onboarding.permissions.optional_title")}
              </DialogTitle>
              <DialogDescription>
                {t("onboarding.permissions.body")}
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <DialogFooter>
          {step === "privacy" && (
            <>
              <Button variant="outline" onClick={finish}>
                {t("onboarding.permissions.dismiss")}
              </Button>
              <Button onClick={() => setStep("provider")}>
                {t("onboarding.continue")}
              </Button>
            </>
          )}
          {step === "provider" && (
            <>
              <Button variant="ghost" onClick={openProviderSetup}>
                {t("onboarding.provider.open_setup")}
              </Button>
              <Button variant="outline" onClick={() => setStep("permissions")}>
                {t("onboarding.provider.skip")}
              </Button>
              {connection?.kind === "connected" ? (
                <Button onClick={() => setStep("permissions")}>
                  {t("onboarding.continue")}
                </Button>
              ) : (
                <Button
                  disabled={checking || !baseUrl.trim()}
                  onClick={testConnection}>
                  {checking && <Loader2 className="icon-sm animate-spin" />}
                  {t("settings.providers.test")}
                </Button>
              )}
            </>
          )}
          {step === "permissions" && (
            <>
              <Button variant="outline" onClick={finish}>
                {t("onboarding.permissions.dismiss")}
              </Button>
              <Button onClick={openPermissions}>
                {t("onboarding.permissions.open")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
