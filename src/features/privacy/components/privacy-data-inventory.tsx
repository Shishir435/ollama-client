import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { getStorageStats } from "@/lib/embeddings/vector-store"
import { knowledgeDb } from "@/lib/knowledge/knowledge-sets"
import {
  Database,
  HardDrive,
  MessageSquare,
  ShieldCheck
} from "@/lib/lucide-icon"
import { countMessages, getAllSessions } from "@/lib/repositories/chat-history"

interface InventoryCounts {
  sessions: number
  messages: number
  vectors: number
  knowledgeFiles: number
}

const EMPTY_COUNTS: InventoryCounts = {
  sessions: 0,
  messages: 0,
  vectors: 0,
  knowledgeFiles: 0
}

export const PrivacyDataInventory = () => {
  const { t } = useTranslation()
  const [counts, setCounts] = useState(EMPTY_COUNTS)

  useEffect(() => {
    let active = true
    Promise.all([
      getAllSessions(),
      countMessages(),
      getStorageStats(),
      knowledgeDb.knowledgeFiles.count()
    ])
      .then(([sessions, messages, vectors, knowledgeFiles]) => {
        if (!active) return
        setCounts({
          sessions: sessions.length,
          messages,
          vectors: vectors.totalVectors,
          knowledgeFiles
        })
      })
      .catch(() => {
        // Inventory is informational. Keep zero-state if one store is unavailable.
      })
    return () => {
      active = false
    }
  }, [])

  const rows = [
    {
      key: "chat",
      icon: MessageSquare,
      label: t("settings.privacy_spine.inventory.chat"),
      value: t("settings.privacy_spine.inventory.chat_count", {
        sessions: counts.sessions,
        messages: counts.messages
      })
    },
    {
      key: "knowledge",
      icon: Database,
      label: t("settings.privacy_spine.inventory.knowledge"),
      value: t("settings.privacy_spine.inventory.knowledge_count", {
        files: counts.knowledgeFiles,
        vectors: counts.vectors
      })
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
      <div className="grid gap-2">
        {rows.map((row) => {
          const Icon = row.icon
          return (
            <div
              key={row.key}
              className="flex items-center gap-3 rounded-control border border-border/45 p-3">
              <Icon className="icon-md shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.value}</p>
              </div>
              <Badge variant="secondary">
                {t("settings.privacy_spine.device_local")}
              </Badge>
            </div>
          )
        })}
        <div className="flex items-center justify-between rounded-control border border-border/45 p-3">
          <div>
            <p className="text-sm font-medium">
              {t("settings.privacy_spine.inventory.preferences")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.privacy_spine.inventory.preferences_description")}
            </p>
          </div>
          <Badge variant="outline">{t("settings.privacy_spine.synced")}</Badge>
        </div>
      </div>
    </SettingsCard>
  )
}
