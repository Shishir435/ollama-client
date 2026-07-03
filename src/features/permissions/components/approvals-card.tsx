import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"

import { SettingsCard } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { STORAGE_KEYS } from "@/lib/constants"
import { ShieldCheck } from "@/lib/lucide-icon"
import { getPlasmoStorageForKey } from "@/lib/plasmo-global-storage"
import {
  type ApprovalGrantMap,
  clearAllApprovalGrants,
  revokeApprovalGrant
} from "@/lib/tools/approval/approval-grants"
import { NO_ORIGIN } from "@/lib/tools/approval/approval-policy"
import { getToolDisplayMeta } from "@/lib/tools/tool-display"

const grantsStorage = getPlasmoStorageForKey(STORAGE_KEYS.TOOLS.APPROVAL_GRANTS)

/**
 * Settings → Privacy → Approvals: every persisted "Always allow" grant on this
 * device, revocable one-by-one or all at once. Session-scoped grants aren't
 * listed — they die with the chat (or the service worker) by design.
 */
export const ApprovalsCard = () => {
  const { t, i18n } = useTranslation()
  const [grants] = useStorage<ApprovalGrantMap>(
    { key: STORAGE_KEYS.TOOLS.APPROVAL_GRANTS, instance: grantsStorage },
    {}
  )

  const entries = Object.entries(grants ?? {}).sort(
    ([, a], [, b]) => b.grantedAt - a.grantedAt
  )

  const toolLabel = (toolName: string): string => {
    const key = getToolDisplayMeta(toolName).displayNameKey
    return key ? t(key) : toolName
  }

  return (
    <SettingsCard
      focusId="tool-approvals"
      icon={ShieldCheck}
      title={t("settings.permissions.approvals.title")}
      description={t("settings.permissions.approvals.description")}>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.permissions.approvals.empty")}
        </p>
      ) : (
        <div className="grid gap-2">
          {entries.map(([key, grant]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {toolLabel(grant.toolName)}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {grant.origin === NO_ORIGIN
                    ? t("settings.permissions.approvals.origin_any")
                    : grant.origin}
                  {" · "}
                  {t("settings.permissions.approvals.granted_on", {
                    date: new Date(grant.grantedAt).toLocaleDateString(
                      i18n.language
                    )
                  })}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => revokeApprovalGrant(key)}>
                {t("settings.permissions.approvals.revoke")}
              </Button>
            </div>
          ))}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-status-danger hover:text-status-danger"
              onClick={() => clearAllApprovalGrants()}>
              {t("settings.permissions.approvals.clear_all")}
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
  )
}
