import { Trans, useTranslation } from "react-i18next"
import { PerformanceWarning } from "@/components/performance-warning"
import { SettingsButton } from "@/components/settings-button"
import { SocialHandles } from "@/components/social-handles"
import { Button } from "@/components/ui/button"
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import {
  AlertTriangle,
  CheckCircle,
  Cpu,
  ExternalLink,
  Globe,
  RefreshCw,
  Shield,
  Sparkles,
  Zap
} from "@/lib/lucide-icon"

export const WelcomeScreen = () => {
  const { status, refresh } = useOllamaModels()
  const { createSession } = useChatSessions()
  const { t } = useTranslation()

  const getStatusConfig = () => {
    switch (status) {
      case "loading":
        return {
          icon: RefreshCw,
          iconClass: "animate-spin",
          title: t("welcome.status.connecting.title"),
          message: t("welcome.status.connecting.message")
        }
      case "error":
        return {
          icon: AlertTriangle,
          iconClass: "",
          title: t("welcome.status.connection_failed.title"),
          message: t("welcome.status.connection_failed.message")
        }
      case "empty":
        return {
          icon: AlertTriangle,
          iconClass: "",
          title: t("welcome.status.no_models.title"),
          message: t("welcome.status.no_models.message")
        }
      case "ready":
        return {
          icon: CheckCircle,
          iconClass: "",
          title: t("welcome.status.ready.title"),
          message: t("welcome.status.ready.message")
        }
      default:
        return null
    }
  }

  const statusConfig = getStatusConfig()

  return (
    <div className="flex w-full flex-col items-center justify-start overflow-auto rounded-b-lg rounded-t-2xl bg-white px-4 py-6 text-center text-gray-900 scrollbar-none dark:bg-gray-900 dark:text-gray-100">
      <div className="mb-6 flex flex-col items-center">
        <div className="mb-3 rounded-3xl bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 p-3 shadow-xl transition-transform hover:scale-105 dark:shadow-blue-500/20">
          <Sparkles className="h-8 w-8 animate-pulse text-white" />
        </div>
        <h1 className="mb-2 bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-3xl font-bold text-transparent dark:from-blue-400 dark:via-purple-400 dark:to-indigo-400">
          {t("welcome.title")}
        </h1>
        <p className="text-base font-medium text-slate-600 dark:text-slate-300">
          {t("welcome.subtitle")}
        </p>
      </div>

      <div className="mb-6 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FeatureCard
          icon={Shield}
          color="green"
          title={t("welcome.features.private.title")}
          description={t("welcome.features.private.description")}
        />
        <FeatureCard
          icon={Globe}
          color="blue"
          title={t("welcome.features.offline.title")}
          description={t("welcome.features.offline.description")}
        />
        <FeatureCard
          icon={Cpu}
          color="purple"
          title={t("welcome.features.local_processing.title")}
          description={t("welcome.features.local_processing.description")}
        />
        <FeatureCard
          icon={Sparkles}
          color="indigo"
          title={t("welcome.features.embeddings.title")}
          description={t("welcome.features.embeddings.description")}
        />
      </div>

      {statusConfig && (
        <div
          className={`mb-5 w-full max-w-lg rounded-xl border-2 p-4 shadow-lg transition-all ${
            status === "error"
              ? "border-red-200 bg-gradient-to-r from-red-50 to-pink-50 dark:border-red-700 dark:from-red-950/30 dark:to-pink-950/30"
              : status === "empty"
                ? "border-yellow-200 bg-gradient-to-r from-yellow-50 to-amber-50 dark:border-yellow-700 dark:from-yellow-950/30 dark:to-amber-950/30"
                : status === "ready"
                  ? "border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 dark:border-green-700 dark:from-green-950/30 dark:to-emerald-950/30"
                  : "border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 dark:border-blue-700 dark:from-blue-950/30 dark:to-indigo-950/30"
          }`}>
          <div className="flex items-start gap-3">
            <div
              className={`rounded-full p-1.5 shadow-md ${
                status === "error"
                  ? "bg-gradient-to-r from-red-500 to-pink-500"
                  : status === "empty"
                    ? "bg-gradient-to-r from-yellow-500 to-amber-500"
                    : status === "ready"
                      ? "bg-gradient-to-r from-green-500 to-emerald-500"
                      : "bg-gradient-to-r from-blue-500 to-indigo-500"
              }`}>
              <statusConfig.icon
                className={`h-4 w-4 text-white ${statusConfig.iconClass}`}
              />
            </div>
            <div className="flex-1 text-left">
              <p
                className={`mb-1 text-base font-bold ${
                  status === "error"
                    ? "text-red-800 dark:text-red-300"
                    : status === "empty"
                      ? "text-yellow-800 dark:text-yellow-300"
                      : status === "ready"
                        ? "text-green-800 dark:text-green-300"
                        : "text-blue-800 dark:text-blue-300"
                }`}>
                {statusConfig.title}
              </p>
              <p
                className={`mb-3 text-sm leading-relaxed ${
                  status === "error"
                    ? "text-red-700 dark:text-red-400"
                    : status === "empty"
                      ? "text-yellow-700 dark:text-yellow-400"
                      : status === "ready"
                        ? "text-green-700 dark:text-green-400"
                        : "text-blue-700 dark:text-blue-400"
                }`}>
                {statusConfig.message}
              </p>

              {status === "error" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refresh}
                  className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-600 dark:text-red-300 dark:hover:bg-red-900/30">
                  <RefreshCw className="mr-1 h-3 w-3" />
                  {t("common.actions.retry")}
                </Button>
              )}

              {status === "empty" && (
                <div className="flex flex-col gap-3 text-left text-sm text-yellow-700 dark:text-yellow-400">
                  <p className="font-medium">
                    {t("welcome.setup_guide.intro")}
                  </p>
                  <ol className="list-inside list-decimal space-y-1">
                    <li>
                      <Trans i18nKey="welcome.setup_guide.step1">
                        Install <code className="font-mono">ollama</code> on
                        your system
                      </Trans>
                    </li>
                    <li>
                      <Trans i18nKey="welcome.setup_guide.step2">
                        Run <code className="font-mono">ollama run llama3</code>{" "}
                        or any model
                      </Trans>
                    </li>
                    <li>
                      <Trans i18nKey="welcome.setup_guide.step3">
                        Return here and click <b>Refresh</b>
                      </Trans>
                    </li>
                  </ol>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <a
                      href="https://ollama-client.shishirchaurasiya.in/ollama-setup-guide"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-all hover:scale-105 hover:bg-blue-700">
                      <ExternalLink className="h-3 w-3" />
                      {t("welcome.setup_guide.full_guide_link")}
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={refresh}
                      className="border-yellow-300 text-yellow-700 hover:bg-yellow-100 dark:border-yellow-600 dark:text-yellow-300 dark:hover:bg-yellow-900/30">
                      <RefreshCw className="mr-1 h-3 w-3" />
                      {t("common.actions.refresh")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mb-5 flex items-center gap-3">
        <Button
          variant="default"
          disabled={status === "error" || status === "empty"}
          className={`group flex items-center gap-2 rounded-xl px-6 py-3 text-base font-bold shadow-xl transition-all duration-300 ${
            status === "error" || status === "empty"
              ? "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
              : "bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 text-white hover:scale-110 hover:from-blue-700 hover:via-purple-700 hover:to-indigo-700 hover:shadow-2xl hover:shadow-blue-500/25"
          }`}
          onClick={async () => {
            await createSession()
            const textarea = document.getElementById("chat-input-textarea")
            textarea?.focus()
          }}>
          <Zap
            className={`h-5 w-5 transition-transform ${status !== "error" && status !== "empty" ? "group-hover:rotate-12" : ""}`}
          />
          {t("welcome.start_chatting")}
        </Button>
        <SettingsButton />
      </div>
      <div className="mb-5">
        <PerformanceWarning />
      </div>

      <div className="mb-4 transform transition-transform hover:scale-105">
        <SocialHandles />
      </div>
    </div>
  )
}

const FeatureCard = ({
  icon: Icon,
  color,
  title,
  description
}: {
  icon: React.ComponentType<{ className?: string }>
  color: "green" | "blue" | "purple" | "indigo"
  title: string
  description: string
}) => {
  const colorVariants = {
    green: {
      border: "border-green-200 dark:border-green-800",
      bg: "bg-green-50 dark:bg-green-950/30",
      iconBg: "bg-green-500",
      titleText: "text-green-800 dark:text-green-300",
      descText: "text-green-600 dark:text-green-400"
    },
    blue: {
      border: "border-blue-200 dark:border-blue-800",
      bg: "bg-blue-50 dark:bg-blue-950/30",
      iconBg: "bg-blue-500",
      titleText: "text-blue-800 dark:text-blue-300",
      descText: "text-blue-600 dark:text-blue-400"
    },
    purple: {
      border: "border-purple-200 dark:border-purple-800",
      bg: "bg-purple-50 dark:bg-purple-950/30",
      iconBg: "bg-purple-500",
      titleText: "text-purple-800 dark:text-purple-300",
      descText: "text-purple-600 dark:text-purple-400"
    },
    indigo: {
      border: "border-indigo-200 dark:border-indigo-800",
      bg: "bg-indigo-50 dark:bg-indigo-950/30",
      iconBg: "bg-indigo-500",
      titleText: "text-indigo-800 dark:text-indigo-300",
      descText: "text-indigo-600 dark:text-indigo-400"
    }
  }

  const variant = colorVariants[color]

  return (
    <div
      className={`group flex items-center gap-3 rounded-xl border p-4 transition-all duration-200 hover:scale-105 hover:shadow-lg ${variant.border} ${variant.bg}`}>
      <div
        className={`flex-shrink-0 rounded-lg p-2 transition-transform duration-200 group-hover:rotate-12 ${variant.iconBg}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="flex-1 text-left">
        <p
          className={`text-sm font-semibold leading-tight ${variant.titleText}`}>
          {title}
        </p>
        <p className={`text-xs leading-relaxed ${variant.descText}`}>
          {description}
        </p>
      </div>
    </div>
  )
}
