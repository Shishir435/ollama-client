import { SectionStack } from "@/components/layout"
import { DataMigrationSettings } from "@/features/knowledge/components/data-migration-settings"
import { PermissionsPanel } from "@/features/permissions/components/permissions-panel"
import { RestoreSessionsLimitSettings } from "@/features/permissions/components/restore-sessions-limit-settings"
import { ExportPrivacySettings } from "@/features/privacy/components/export-privacy-settings"
import { PrivacyDataInventory } from "@/features/privacy/components/privacy-data-inventory"
import { ResetStorage } from "@/options/components/reset-storage"

export default function PrivacySettingsTab() {
  return (
    <SectionStack>
      <PrivacyDataInventory />
      <DataMigrationSettings />
      <PermissionsPanel />
      <ExportPrivacySettings />
      <RestoreSessionsLimitSettings />
      <ResetStorage />
    </SectionStack>
  )
}
