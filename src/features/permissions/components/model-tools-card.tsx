import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  SettingsActionRow,
  SettingsCard,
  SettingsLevelGate,
  SettingsSwitch
} from "@/components/settings"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { Bot } from "@/lib/lucide-icon"
import { TOOL_FAMILIES, type ToolFamily } from "@/lib/tools/tool-families"
import {
  clearToolModelOverride,
  getAllToolModelOverrides,
  getEffectiveToolFamilySettings,
  patchToolModelOverride,
  type ToolFamilyOverride,
  type ToolModelOverrideMap,
  toolModelOverrideKey
} from "@/lib/tools/tool-model-overrides"
import {
  getToolFamilySettings,
  setToolFamilyEnabled,
  setToolMasterEnabled,
  type ToolFamilySettings
} from "@/lib/tools/tool-settings"

const ModelToolOverridesSection = () => {
  const { t } = useTranslation()
  const { models } = useProviderModels()
  const [overrides, setOverrides] = useState<ToolModelOverrideMap>({})
  const [targetKey, setTargetKey] = useState("")
  const [effective, setEffective] = useState<ToolFamilySettings | null>(null)

  const entries = useMemo(
    () =>
      (models ?? []).map((model) => {
        const providerId = model.providerId || DEFAULT_PROVIDER_ID
        return {
          providerId,
          name: model.name,
          key: toolModelOverrideKey(providerId, model.name)
        }
      }),
    [models]
  )

  const reloadOverrides = useCallback(() => {
    getAllToolModelOverrides().then(setOverrides)
  }, [])

  useEffect(() => {
    reloadOverrides()
  }, [reloadOverrides])

  const target = entries.find((entry) => entry.key === targetKey) ?? null
  const targetProviderId = target?.providerId
  const targetName = target?.name

  const loadEffective = useCallback(
    async (providerId?: string, name?: string) => {
      if (!providerId || !name) {
        setEffective(null)
        return
      }
      setEffective(await getEffectiveToolFamilySettings(providerId, name))
    },
    []
  )

  useEffect(() => {
    loadEffective(targetProviderId, targetName)
  }, [targetProviderId, targetName, loadEffective])

  if (entries.length === 0) {
    return (
      <p
        data-settings-focus-id="model-tools-per-model"
        className="border-t pt-3 text-xs text-muted-foreground">
        {t("settings.permissions.tools.perModel.empty")}
      </p>
    )
  }

  const applyChange = async (patch: ToolFamilyOverride) => {
    if (!target) return
    await patchToolModelOverride(target.providerId, target.name, patch)
    reloadOverrides()
    await loadEffective(target.providerId, target.name)
  }

  const onReset = async () => {
    if (!target) return
    await clearToolModelOverride(target.providerId, target.name)
    reloadOverrides()
    await loadEffective(target.providerId, target.name)
  }

  const hasOverride = target ? Boolean(overrides[target.key]) : false

  return (
    <div className="grid gap-2 border-t pt-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">
          {t("settings.permissions.tools.perModel.title")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("settings.permissions.tools.perModel.description")}
        </span>
      </div>

      <Select
        value={targetKey}
        onValueChange={(value) => {
          if (value !== null) setTargetKey(value)
        }}>
        <SelectTrigger
          data-settings-focus-id="model-tools-per-model"
          className="w-full">
          <SelectValue
            placeholder={t(
              "settings.permissions.tools.perModel.selectPlaceholder"
            )}
          />
        </SelectTrigger>
        <SelectContent>
          {entries.map((entry) => (
            <SelectItem key={entry.key} value={entry.key}>
              {entry.name}
              {overrides[entry.key]
                ? ` · ${t("settings.permissions.tools.perModel.customBadge")}`
                : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {target && effective && (
        <div className="grid gap-2">
          <SettingsSwitch
            id="model-tools-override-master"
            label={t("settings.permissions.tools.master.label")}
            checked={effective.enabled}
            onCheckedChange={(next) => applyChange({ enabled: next })}
          />
          <div
            className={effective.enabled ? undefined : "opacity-60"}
            aria-disabled={!effective.enabled}>
            <div className="grid gap-2">
              {TOOL_FAMILIES.map((family) => (
                <SettingsSwitch
                  key={family}
                  id={`model-tools-override-family-${family}`}
                  label={t(
                    `settings.permissions.tools.families.${family}.label`
                  )}
                  checked={effective.families[family]}
                  onCheckedChange={(next) =>
                    applyChange({ families: { [family]: next } })
                  }
                />
              ))}
            </div>
          </div>
          <SettingsSwitch
            id="model-tools-override-nonnative-fallback"
            label={t(
              "settings.permissions.tools.perModel.nonNativeFallback.label"
            )}
            description={t(
              "settings.permissions.tools.perModel.nonNativeFallback.description"
            )}
            checked={Boolean(overrides[target.key]?.nonNativeToolFallback)}
            onCheckedChange={(next) =>
              applyChange({ nonNativeToolFallback: next })
            }
          />
          {hasOverride && (
            <SettingsActionRow>
              <Button variant="ghost" size="sm" onClick={onReset}>
                {t("settings.permissions.tools.perModel.reset")}
              </Button>
            </SettingsActionRow>
          )}
        </div>
      )}
    </div>
  )
}

export const ModelToolsCard = ({ compact }: { compact: boolean }) => {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<ToolFamilySettings | null>(null)

  useEffect(() => {
    let active = true
    getToolFamilySettings().then((value) => {
      if (active) setSettings(value)
    })
    return () => {
      active = false
    }
  }, [])

  if (!settings) return null

  const onMaster = async (next: boolean) => {
    setSettings(await setToolMasterEnabled(next))
  }
  const onFamily = (family: ToolFamily) => async (next: boolean) => {
    setSettings(await setToolFamilyEnabled(family, next))
  }

  return (
    <SettingsCard
      focusId="model-tools"
      icon={Bot}
      title={t("settings.permissions.tools.title")}
      description={t("settings.permissions.tools.description")}>
      <SettingsSwitch
        id="model-tools-master"
        label={t("settings.permissions.tools.master.label")}
        description={t("settings.permissions.tools.master.description")}
        checked={settings.enabled}
        onCheckedChange={onMaster}
      />
      <div
        className={settings.enabled ? undefined : "opacity-60"}
        aria-disabled={!settings.enabled}>
        <div className="grid gap-2">
          {TOOL_FAMILIES.map((family) => (
            <SettingsSwitch
              key={family}
              id={`model-tools-family-${family}`}
              label={t(`settings.permissions.tools.families.${family}.label`)}
              description={t(
                `settings.permissions.tools.families.${family}.description`
              )}
              checked={settings.families[family]}
              onCheckedChange={onFamily(family)}
            />
          ))}
        </div>
      </div>
      {!compact && (
        <SettingsLevelGate settingId="model-tools-per-model">
          <ModelToolOverridesSection />
        </SettingsLevelGate>
      )}
    </SettingsCard>
  )
}
