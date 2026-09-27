import { AlertTriangle, Brain, RefreshCw } from "lucide-react"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { SectionStack } from "@/components/layout"
import { SettingsCard, StatusAlert } from "@/components/settings"
import { FeedbackSettings } from "@/features/knowledge/components/feedback-settings"
import { useEmbeddingRebuildWorkflow } from "@/features/model/hooks/use-embedding-rebuild-workflow"
import { useEmbeddingSettingsState } from "@/features/model/hooks/use-embedding-settings-state"
import { useNativeEmbeddings } from "../hooks/use-native-embeddings"
import { EmbeddingGenerationConfig } from "./embedding-config/embedding-generation-config"
import { EmbeddingHealthAlert } from "./embedding-config/embedding-health-alert"
import { EmbeddingModelSelector } from "./embedding-config/embedding-model-selector"
import { EmbeddingRebuildDialogs } from "./embedding-config/embedding-rebuild-dialogs"
import { EmbeddingStorageSettings } from "./embedding-config/embedding-storage-settings"
import { EmbeddingTestGeneration } from "./embedding-config/embedding-test-generation"
import { EmbeddingTestSearch } from "./embedding-config/embedding-test-search"
import { NativeEmbeddingSection } from "./native-embedding-section"

/** Composition root for the embeddings settings screen. */
export const EmbeddingSettings = () => {
  const { t } = useTranslation()
  const native = useNativeEmbeddings()
  const settings = useEmbeddingSettingsState()
  const rebuild = useEmbeddingRebuildWorkflow({
    memoryEnabled: settings.memoryEnabled,
    applyModelChange: settings.applyModelChange
  })

  const handleToggleShowAdvanced = useCallback(
    (checked: boolean) =>
      settings.updateConfig({ showAdvancedEmbeddingModels: checked }),
    [settings.updateConfig]
  )

  return (
    <SectionStack>
      <EmbeddingHealthAlert
        stats={rebuild.dimensionStats}
        memoryEnabled={settings.memoryEnabled}
        isRebuilding={rebuild.isRebuilding}
        rebuildProgress={rebuild.progress}
        onRebuildRequest={() => rebuild.setConfirmRebuildOpen(true)}
      />
      {rebuild.error && (
        <StatusAlert
          variant="destructive"
          icon={AlertTriangle}
          title={t("settings.context.embedding_health.error")}
          description={rebuild.error}
        />
      )}
      {rebuild.complete && (
        <StatusAlert
          variant="success"
          icon={RefreshCw}
          title={t("settings.context.embedding_health.success")}
        />
      )}
      <SettingsCard
        icon={Brain}
        title={t("settings.embeddings.title")}
        description={t("settings.embeddings.description")}
        contentClassName="divide-y divide-border *:py-6 *:first:pt-0 *:last:pb-0">
        {native.state && (
          <NativeEmbeddingSection native={native}>
            <EmbeddingModelSelector
              selectedModel={settings.selectedModel}
              config={settings.config}
              embeddingModels={settings.embeddingModels}
              hasAdvancedModels={settings.hasAdvancedModels}
              isRebuilding={
                rebuild.isRebuilding || native.state.migration === "building"
              }
              showRebuildNotice={rebuild.isRebuilding}
              rebuildProgress={rebuild.progress}
              onModelSelected={
                native.state.mode === "bundled"
                  ? (model, providerId) =>
                      settings.applyModelChange(
                        model,
                        providerId,
                        "shared-model"
                      )
                  : rebuild.requestModelChange
              }
              onToggleShowAdvanced={handleToggleShowAdvanced}
            />
          </NativeEmbeddingSection>
        )}
        <EmbeddingTestGeneration
          modelExists={native.state?.mode === "bundled" || settings.modelExists}
        />
        <EmbeddingTestSearch
          modelExists={native.state?.mode === "bundled" || settings.modelExists}
        />
        <EmbeddingGenerationConfig
          config={settings.config}
          updateConfig={settings.updateConfig}
        />
        <EmbeddingStorageSettings
          config={settings.config}
          updateConfig={settings.updateConfig}
          isRebuilding={rebuild.isRebuilding}
          onStoreChanged={rebuild.refreshDimensionStats}
        />
      </SettingsCard>
      <FeedbackSettings />
      <EmbeddingRebuildDialogs
        confirmRebuildOpen={rebuild.confirmRebuildOpen}
        onConfirmRebuildOpenChange={rebuild.setConfirmRebuildOpen}
        onConfirmRebuild={rebuild.rebuild}
        modelChangeOpen={rebuild.modelChangeOpen}
        onModelChangeOpenChange={rebuild.setModelChangeOpen}
        onSwitchOnly={rebuild.switchModel}
        onSwitchAndRebuild={rebuild.switchModelAndRebuild}
      />
    </SectionStack>
  )
}
