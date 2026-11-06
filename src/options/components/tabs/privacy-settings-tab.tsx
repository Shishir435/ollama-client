import { useTranslation } from "react-i18next"
import { SectionStack } from "@/components/layout"
import { DataMigrationSettings } from "@/features/knowledge/components/data-migration-settings"
import { PermissionsPanel } from "@/features/permissions/components/permissions-panel"
import { RestoreSessionsLimitSettings } from "@/features/permissions/components/restore-sessions-limit-settings"
import { ExportPrivacySettings } from "@/features/privacy/components/export-privacy-settings"
import { PrivacyDataInventory } from "@/features/privacy/components/privacy-data-inventory"
import { motionSafeScrollBehavior } from "@/lib/reduced-motion"
import { ResetStorage } from "@/options/components/reset-storage"
import { PRIVACY_SECTION_IDS } from "./privacy-section-ids"

const SECTIONS = [
  { id: PRIVACY_SECTION_IDS.access, labelKey: "settings.privacy_tab.access" },
  { id: PRIVACY_SECTION_IDS.backup, labelKey: "settings.privacy_tab.backup" },
  { id: PRIVACY_SECTION_IDS.reset, labelKey: "settings.privacy_tab.reset" }
] as const

const PrivacyGroup = ({
  id,
  title,
  description,
  children
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) => (
  <section
    id={id}
    tabIndex={-1}
    aria-labelledby={`${id}-heading`}
    className="scroll-mt-4 space-y-4 outline-none">
    <div className="space-y-1">
      <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    <SectionStack>{children}</SectionStack>
  </section>
)

export default function PrivacySettingsTab() {
  const { t } = useTranslation()

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      block: "start",
      behavior: motionSafeScrollBehavior()
    })
  }

  return (
    <SectionStack>
      <nav aria-label={t("settings.privacy_tab.index_label")}>
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => jumpTo(section.id)}
                className="rounded-control border border-stroke-control bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus">
                {t(section.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <PrivacyGroup
        id={PRIVACY_SECTION_IDS.access}
        title={t("settings.privacy_tab.access")}
        description={t("settings.privacy_tab.access_description")}>
        <PrivacyDataInventory />
        <PermissionsPanel />
        <RestoreSessionsLimitSettings />
      </PrivacyGroup>

      <PrivacyGroup
        id={PRIVACY_SECTION_IDS.backup}
        title={t("settings.privacy_tab.backup")}
        description={t("settings.privacy_tab.backup_description")}>
        <DataMigrationSettings />
        <ExportPrivacySettings />
      </PrivacyGroup>

      <PrivacyGroup
        id={PRIVACY_SECTION_IDS.reset}
        title={t("settings.privacy_tab.reset")}
        description={t("settings.privacy_tab.reset_description")}>
        <ResetStorage />
      </PrivacyGroup>
    </SectionStack>
  )
}
