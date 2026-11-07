import {
  Bot,
  Cloud,
  Database,
  HardDrive,
  MessageSquare,
  ShieldCheck
} from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { getStorageStats } from "@/lib/embeddings/vector-store"
import { knowledgeDb } from "@/lib/knowledge/knowledge-sets"
import { countAgentRuns } from "@/lib/repositories/agent-runs"
import { countMessages, getAllSessions } from "@/lib/repositories/chat-history"

interface InventoryCounts {
  sessions: number
  messages: number
  vectors: number
  knowledgeFiles: number
  agentRuns: number
}

export const PrivacyDataInventory = () => {
  const { t } = useTranslation()
  const [counts, setCounts] = useState<InventoryCounts | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      getAllSessions(),
      countMessages(),
      getStorageStats(),
      knowledgeDb.knowledgeFiles.count(),
      countAgentRuns()
    ])
      .then(([sessions, messages, vectors, knowledgeFiles, agentRuns]) => {
        if (!active) return
        setCounts({
          sessions: sessions.length,
          messages,
          vectors: vectors.totalVectors,
          knowledgeFiles,
          agentRuns
        })
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  const pending = failed
    ? t("settings.privacy_spine.inventory.unavailable")
    : t("settings.privacy_spine.inventory.loading")

  const rows = [
    {
      key: "chat",
      icon: MessageSquare,
      label: t("settings.privacy_spine.inventory.chat"),
      value: counts
        ? t("settings.privacy_spine.inventory.chat_count", {
            sessions: counts.sessions,
            messages: counts.messages
          })
        : pending
    },
    {
      key: "knowledge",
      icon: Database,
      label: t("settings.privacy_spine.inventory.knowledge"),
      value: counts
        ? t("settings.privacy_spine.inventory.knowledge_count", {
            files: counts.knowledgeFiles,
            vectors: counts.vectors
          })
        : pending
    },
    {
      key: "agent",
      icon: Bot,
      label: t("settings.privacy_spine.inventory.agent"),
      value: counts
        ? t("settings.privacy_spine.inventory.agent_count", {
            runs: counts.agentRuns
          })
        : pending
    },
    {
      key: "settings",
      icon: HardDrive,
      label: t("settings.privacy_spine.inventory.settings"),
      value: t("settings.privacy_spine.inventory.settings_description")
    }
  ]

  return (
    <SettingsCard
      focusId="privacy-data-inventory"
      icon={ShieldCheck}
      title={t("settings.privacy_spine.inventory.title")}
      description={t("settings.privacy_spine.inventory.description")}>
      <div className="divide-y divide-border">
        {rows.map((row) => {
          const Icon = row.icon
          return (
            <SettingsRow
              key={row.key}
              leading={
                <Icon className="icon-md shrink-0 text-muted-foreground" />
              }
              label={row.label}
              description={
                <span role={failed && !counts ? "alert" : undefined}>
                  {row.value}
                </span>
              }
              control={
                <Badge variant="secondary">
                  {t("settings.privacy_spine.device_local")}
                </Badge>
              }
            />
          )
        })}
        <SettingsRow
          leading={<Cloud className="icon-md shrink-0 text-muted-foreground" />}
          label={t("settings.privacy_spine.inventory.preferences")}
          description={t(
            "settings.privacy_spine.inventory.preferences_description"
          )}
          control={
            <Badge variant="outline">
              {t("settings.privacy_spine.synced")}
            </Badge>
          }
        />
      </div>
    </SettingsCard>
  )
}
