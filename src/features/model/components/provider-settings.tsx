import { CheckCircle2, Info, Loader2, Trash2, XCircle, Zap } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { StatusCallout } from "@/components/feedback"
import { FieldStack, InlineActions, SectionStack } from "@/components/layout"
import { SettingsControlCard, SettingsSwitch } from "@/components/settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { MiniBadge } from "@/components/ui/mini-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { AddProviderDialog } from "@/features/model/components/add-provider-dialog"
import { ProviderConnectionFields } from "@/features/model/components/provider-connection-fields"
import { ProviderCustomModels } from "@/features/model/components/provider-custom-models"
import { ProviderGrid } from "@/features/model/components/provider-grid"
import { useProviderSettingsState } from "@/features/model/hooks/use-provider-settings-state"
import {
  CATALOG_REFRESH_CHOICES_MS,
  normalizeCatalogRefreshMs
} from "@/features/model/lib/catalog-refresh"
import { useSetting } from "@/hooks/use-setting"
import { cn } from "@/lib/class-names"
import { isBetaProvider } from "@/lib/providers/registry"
import { ProviderId } from "@/lib/providers/types"
import { SETTINGS } from "@/lib/storage/settings"

export const ProviderSettings = () => {
  const { t } = useTranslation()
  const {
    providers,
    loading,
    selectedId,
    setSelectedId,
    activeConfig,
    cspCompatibilityHint,
    isLocalProvider,
    isCustomProvider,
    isRemoteEndpoint,
    testingConnection,
    connectionStatus,
    hasUnsavedChanges,
    providerHealth,
    headerStatus,
    handleTestConnection,
    handleSave,
    updateConfig,
    setCustomModels,
    setProviderEnabled,
    addProvider,
    removeProvider
  } = useProviderSettingsState()
  const [addOpen, setAddOpen] = useState(false)
  const [iconLookup, setIconLookup] = useSetting(
    SETTINGS.PROVIDER_FAVICON_LOOKUP
  )
  const [catalogRefreshMs, setCatalogRefreshMs] = useSetting(
    SETTINGS.PROVIDER_CATALOG_REFRESH_MS
  )
  const [pendingRemoval, setPendingRemoval] = useState<{
    id: string
    name: string
  } | null>(null)

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin icon-xl" />
      </div>
    )
  }

  return (
    <SectionStack>
      <div data-settings-focus="true" data-settings-focus-id="provider-picker">
        <ProviderGrid
          providers={providers}
          selectedId={selectedId}
          providerHealth={providerHealth}
          manualTestStatus={connectionStatus}
          onSelect={setSelectedId}
          onAdd={() => setAddOpen(true)}
        />
      </div>

      <SettingsSwitch
        id="provider-icon-lookup"
        label={t("settings.providers.icon_lookup.label")}
        description={t("settings.providers.icon_lookup.description")}
        checked={iconLookup}
        onCheckedChange={setIconLookup}
      />

      <SettingsControlCard
        id="provider-catalog-refresh"
        label={t("settings.providers.catalog_refresh.label")}
        description={t("settings.providers.catalog_refresh.description")}
        control={
          <Select
            // The same normalization the queries poll on, so a value synced
            // from another device cannot leave the trigger blank or disagree
            // with the interval actually in force.
            value={String(normalizeCatalogRefreshMs(catalogRefreshMs))}
            onValueChange={(next) => {
              if (next !== null) {
                setCatalogRefreshMs(normalizeCatalogRefreshMs(Number(next)))
              }
            }}>
            <SelectTrigger id="provider-catalog-refresh" className="w-48">
              <SelectValue>
                {() =>
                  t(
                    `settings.providers.catalog_refresh.options.${normalizeCatalogRefreshMs(catalogRefreshMs)}`
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CATALOG_REFRESH_CHOICES_MS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {t(`settings.providers.catalog_refresh.options.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <AddProviderDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={addProvider}
      />

      {/* Configuration Panel */}
      {activeConfig && (
        <Card>
          <CardHeader className="flex-row items-center justify-between border-b [&>div]:w-full">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "icon-xs shrink-0 rounded-full ring-2 ring-offset-2 ring-offset-background transition-colors",
                  headerStatus.dot
                )}
              />
              <div>
                <CardTitle className="flex items-center gap-2">
                  {activeConfig.name}
                  {isBetaProvider(activeConfig.id) && (
                    <>
                      <MiniBadge text={t("settings.providers.beta_badge")} />
                      <TooltipActionButton
                        trigger={
                          <span className="inline-flex text-muted-foreground hover:text-foreground" />
                        }
                        icon={Info}
                        iconClassName="icon-sm"
                        label={t("settings.providers.beta_notice")}
                        tooltipClassName="max-w-xs"
                      />
                    </>
                  )}
                </CardTitle>
                <CardDescription>
                  {t(`settings.providers.${headerStatus.label}`)}
                </CardDescription>
              </div>
            </div>

            <InlineActions className="gap-4">
              <div
                className="flex items-center gap-2"
                data-settings-focus="true"
                data-settings-focus-id="provider-enabled">
                <Label htmlFor="enabled-switch" className="text-sm font-medium">
                  {activeConfig.enabled
                    ? t("settings.providers.enabled")
                    : t("settings.providers.disabled")}
                </Label>
                <Switch
                  id="enabled-switch"
                  checked={activeConfig.enabled}
                  onCheckedChange={setProviderEnabled}
                />
              </div>

              <Button
                data-settings-focus="true"
                data-settings-focus-id="provider-test-connection"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testingConnection}>
                {testingConnection ? (
                  <Loader2 className="icon-md mr-2 animate-spin" />
                ) : (
                  <Zap className="icon-md mr-2" />
                )}
                {t("settings.providers.test")}
              </Button>

              {isCustomProvider && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-status-danger hover:text-status-danger"
                  onClick={() =>
                    setPendingRemoval({
                      id: String(activeConfig.id),
                      name: activeConfig.name
                    })
                  }>
                  <Trash2 className="icon-md mr-2" />
                  {t("settings.providers.add.remove")}
                </Button>
              )}
            </InlineActions>
          </CardHeader>

          {/* Connection Status Banner */}
          {connectionStatus && (
            <StatusCallout
              className="rounded-none border-x-0"
              variant={connectionStatus.success ? "success" : "danger"}
              icon={connectionStatus.success ? CheckCircle2 : XCircle}
              title={
                connectionStatus.success
                  ? t("settings.providers.test_connection.success_title")
                  : t("settings.providers.test_connection.failed_title")
              }
              description={connectionStatus.message}
            />
          )}

          <CardContent>
            <FieldStack>
              <ProviderConnectionFields
                activeConfig={activeConfig}
                cspCompatibilityHint={cspCompatibilityHint}
                isLocalProvider={isLocalProvider}
                isRemoteEndpoint={isRemoteEndpoint}
                hasUnsavedChanges={hasUnsavedChanges}
                onSave={handleSave}
                updateConfig={updateConfig}
              />

              {activeConfig.id !== ProviderId.OLLAMA && (
                <ProviderCustomModels
                  activeConfig={activeConfig}
                  onChange={setCustomModels}
                />
              )}
            </FieldStack>
          </CardContent>
        </Card>
      )}

      {pendingRemoval && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingRemoval(null)
          }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("settings.providers.add.remove_confirm_title", {
                  name: pendingRemoval.name
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("settings.providers.add.remove_confirm_description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (await removeProvider(pendingRemoval.id)) {
                    setPendingRemoval(null)
                  }
                }}>
                {t("settings.providers.add.remove")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </SectionStack>
  )
}
