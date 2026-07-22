import { useState } from "react"
import { useTranslation } from "react-i18next"

import { SettingsCard } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { openExternalUrl } from "@/lib/browser-api"
import { EXTERNAL_URLS } from "@/lib/constants"
import {
  Activity,
  Copy,
  Download,
  Github,
  Loader2,
  Trash2
} from "@/lib/lucide-icon"
import type {
  DiagnosticsGetBundleResult,
  DiagnosticTestResult
} from "@/protocol/diagnostics-rpc"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"

export const buildDiagnosticIssueUrl = (
  bundle: DiagnosticsGetBundleResult["bundle"]
): string => {
  const failed = bundle.selfTests
    .filter((test) => test.status === "fail")
    .map((test) => `- ${test.id}: ${test.code ?? "failed"}`)
  const body = [
    "**What happened**",
    "_Describe the problem here._",
    "",
    "**Safe diagnostic summary**",
    `- Extension: ${bundle.appVersion}`,
    `- Browser: ${bundle.browserFamily}`,
    `- OS: ${bundle.osFamily}`,
    `- Storage backend: ${bundle.storage.backend}`,
    ...(failed.length > 0 ? failed : ["- Self-tests: passed"]),
    "",
    "Review and attach the downloaded support bundle if useful."
  ].join("\n")
  const params = new URLSearchParams({
    title: "[bug] Diagnostics support request",
    body
  })
  return `${EXTERNAL_URLS.GITHUB_ISSUES}/new?${params.toString()}`
}

export const DiagnosticsSettings = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [running, setRunning] = useState(false)
  const [tests, setTests] = useState<DiagnosticTestResult[]>([])
  const [bundle, setBundle] = useState<DiagnosticsGetBundleResult["bundle"]>()
  const preview = bundle ? JSON.stringify(bundle, null, 2) : ""

  const run = async () => {
    setRunning(true)
    try {
      const result = await extensionRpcClient.call(RpcMethod.DiagnosticsRun, {})
      setTests(result.tests)
    } catch {
      toast({ title: t("diagnostics.failed"), variant: "destructive" })
    } finally {
      setRunning(false)
    }
  }

  const loadPreview = async () => {
    setRunning(true)
    try {
      const result = await extensionRpcClient.call(
        RpcMethod.DiagnosticsGetBundle,
        {}
      )
      setBundle(result.bundle)
      setTests(result.bundle.selfTests)
    } catch {
      toast({ title: t("diagnostics.failed"), variant: "destructive" })
    } finally {
      setRunning(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(preview)
      toast({ title: t("diagnostics.copied") })
    } catch {
      toast({ title: t("diagnostics.failed"), variant: "destructive" })
    }
  }

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([preview], { type: "application/json" })
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `ollama-client-support-${bundle?.createdAt ?? Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const clear = async () => {
    try {
      await extensionRpcClient.call(RpcMethod.DiagnosticsClear, {})
      setBundle(undefined)
      toast({ title: t("diagnostics.cleared") })
    } catch {
      toast({ title: t("diagnostics.failed"), variant: "destructive" })
    }
  }

  return (
    <SettingsCard
      icon={Activity}
      title={t("diagnostics.title")}
      description={t("diagnostics.description")}
      focusId="diagnostics-support">
      <div className="flex flex-wrap gap-2">
        <Button disabled={running} onClick={() => void run()}>
          {running && <Loader2 className="icon-sm animate-spin" />}
          {t("diagnostics.run")}
        </Button>
        <Button
          variant="outline"
          disabled={running}
          onClick={() => void loadPreview()}>
          {t("diagnostics.preview")}
        </Button>
      </div>

      {tests.length > 0 && (
        <div className="space-y-2" aria-live="polite">
          {tests.map((test) => (
            <div
              key={test.id}
              className="flex items-center justify-between rounded-control border p-2 text-xs">
              <span>{t(`diagnostics.tests.${test.id}`)}</span>
              <div className="flex items-center gap-2">
                {test.code && (
                  <code className="select-all text-micro">{test.code}</code>
                )}
                <Badge
                  variant={
                    test.status === "pass"
                      ? "secondary"
                      : test.status === "fail"
                        ? "destructive"
                        : "outline"
                  }>
                  {t(`diagnostics.status.${test.status}`)}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {bundle && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("diagnostics.privacy_notice")}
          </p>
          <Textarea
            value={preview}
            readOnly
            className="max-h-80 font-mono text-micro"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void copy()}>
              <Copy className="icon-sm" />
              {t("diagnostics.copy")}
            </Button>
            <Button variant="outline" onClick={download}>
              <Download className="icon-sm" />
              {t("diagnostics.download")}
            </Button>
            <Button
              variant="outline"
              onClick={() => openExternalUrl(buildDiagnosticIssueUrl(bundle))}>
              <Github className="icon-sm" />
              {t("diagnostics.open_issue")}
            </Button>
            <Button variant="ghost" onClick={() => void clear()}>
              <Trash2 className="icon-sm" />
              {t("diagnostics.clear")}
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}
