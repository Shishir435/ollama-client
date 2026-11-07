import { Check, Cpu, Layers3, SlidersHorizontal } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { TooltipActionButton } from "@/components/actions"
import { ProviderIcon } from "@/components/icons"
import { ListRow, ListRowTitleButton } from "@/components/layout/list-row"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useEmbeddingIndexMatch } from "@/features/model/hooks/use-embedding-index-match"
import { useEmbeddingRebuildWorkflow } from "@/features/model/hooks/use-embedding-rebuild-workflow"
import { useEmbeddingSettingsState } from "@/features/model/hooks/use-embedding-settings-state"
import { useNativeEmbeddings } from "@/features/model/hooks/use-native-embeddings"
import { useProviderIcons } from "@/features/model/hooks/use-provider-icons"
import { cn } from "@/lib/class-names"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  RECOMMENDED_EMBEDDING_MODELS
} from "@/lib/constants"
import { recommendedEmbeddingBaseSet } from "@/lib/embeddings/model-name-filter"
import { logger } from "@/lib/logger"
import { getProviderDisplayName } from "@/lib/providers/registry"
import { STATUS_STYLES } from "@/lib/ui-status"
import { EmbeddingRebuildDialogs } from "./embedding-config/embedding-rebuild-dialogs"
import {
  compareModelNames,
  MenuListHeader,
  MenuSearch,
  RailButton,
  RailDivider,
  SelectedSourceDot,
  type SortDirection
} from "./model-menu-parts"

const BUILT_IN_SOURCE = "__built-in-embeddings__"
const BUILT_IN_MODEL = "MiniLM"

interface EmbeddingPickerModel {
  name: string
  providerId: string
  providerName: string
  providerBrand?: string
}

/**
 * A check marks the index answering searches now, as the chat list marks its
 * model; "Selected" waits for a switch.
 */
const RowStatus = ({
  state
}: {
  state: "in-use" | "not-indexed" | "selected" | null
}) => {
  const { t } = useTranslation()
  /**
   * Chosen, but the saved index was not rebuilt for it, so file search finds
   * nothing with it yet: not the same claim as "In use".
   */
  if (state === "not-indexed")
    return (
      <span
        title={t("settings.embeddings.bundled.not_indexed_help")}
        className={cn(
          "shrink-0 rounded-full border px-1.5 text-micro",
          STATUS_STYLES.warning.borderSoft,
          STATUS_STYLES.warning.text
        )}>
        {t("settings.embeddings.bundled.not_indexed")}
      </span>
    )
  if (state === "in-use")
    return (
      <span
        title={t("settings.embeddings.bundled.in_use")}
        className="flex shrink-0">
        <Check aria-hidden="true" className="icon-sm" />
        <span className="sr-only">
          {t("settings.embeddings.bundled.in_use")}
        </span>
      </span>
    )
  return state === "selected" ? (
    <span className="shrink-0 rounded-full border border-border px-1.5 text-micro text-muted-foreground">
      {t("settings.embeddings.bundled.selected")}
    </span>
  ) : null
}

/**
 * The chat model picker's shape for embeddings: one list of models, with the
 * built-in MiniLM as one more source. It reads and writes the same settings and
 * index commands as the Options page, so either surface reflects the other.
 */
export const EmbeddingModelMenuPanel = ({
  railFooter
}: {
  /** Pinned to the foot of the source rail; the model menu's view switch. */
  railFooter?: ReactNode
}) => {
  const { t } = useTranslation()
  const settings = useEmbeddingSettingsState()
  const { isLoading } = settings
  const native = useNativeEmbeddings()
  const rebuild = useEmbeddingRebuildWorkflow({
    memoryEnabled: settings.memoryEnabled,
    applyModelChange: settings.applyModelChange
  })
  const providerIcons = useProviderIcons()
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  /** A mode switch rebuilds the index, so it waits for one explicit confirm. */
  const [requestedSwitch, setPendingSwitch] = useState<
    "start" | "external" | null
  >(null)
  /**
   * The provider model picked while the built-in index is active. It stays
   * here until the switch is confirmed, so Cancel leaves the saved selection
   * alone.
   */
  const [pendingModel, setPendingModel] = useState<{
    name: string
    providerId: string
  } | null>(null)

  const nativeState = native.state
  const activeMode = nativeState?.mode
  /** Options may switch the mode meanwhile; a request already satisfied is dropped. */
  const pendingSwitch =
    requestedSwitch === "start"
      ? activeMode === "external"
        ? requestedSwitch
        : null
      : requestedSwitch === "external" && activeMode === "bundled"
        ? requestedSwitch
        : null
  const migrating = nativeState?.migration === "building"
  const stagedModel = pendingSwitch === "external" ? pendingModel : null
  const selectedProviderId =
    stagedModel?.providerId ||
    settings.config.sharedEmbeddingProviderId ||
    DEFAULT_PROVIDER_ID
  const selectedModel =
    stagedModel?.name ||
    settings.selectedModel ||
    settings.config.sharedEmbeddingModel ||
    DEFAULT_EMBEDDING_MODEL
  const selectedValue = JSON.stringify([selectedProviderId, selectedModel])
  const indexMatch = useEmbeddingIndexMatch(
    selectedModel,
    activeMode === "external" && !stagedModel && !migrating
  )
  const showAdvanced = settings.config.showAdvancedEmbeddingModels === true

  const pickerModels = useMemo(() => {
    const rows = new Map<string, EmbeddingPickerModel>()
    for (const model of settings.embeddingModels) {
      const providerId = model.providerId || DEFAULT_PROVIDER_ID
      rows.set(JSON.stringify([providerId, model.name]), {
        name: model.name,
        providerId,
        providerName: model.providerName || getProviderDisplayName(providerId),
        providerBrand: model.providerBrand
      })
    }

    for (const model of RECOMMENDED_EMBEDDING_MODELS) {
      const key = JSON.stringify([DEFAULT_PROVIDER_ID, model])
      if (!rows.has(key)) {
        rows.set(key, {
          name: model,
          providerId: DEFAULT_PROVIDER_ID,
          providerName: getProviderDisplayName(DEFAULT_PROVIDER_ID)
        })
      }
    }

    if (!rows.has(selectedValue)) {
      rows.set(selectedValue, {
        name: selectedModel,
        providerId: selectedProviderId,
        providerName: getProviderDisplayName(selectedProviderId)
      })
    }

    return [...rows.values()].filter(
      (model) =>
        showAdvanced ||
        recommendedEmbeddingBaseSet.has(
          model.name.toLowerCase().split(":")[0]
        ) ||
        JSON.stringify([model.providerId, model.name]) === selectedValue
    )
  }, [
    selectedModel,
    selectedProviderId,
    selectedValue,
    settings.embeddingModels,
    showAdvanced
  ])

  const providerGroups = useMemo(() => {
    const groups: Record<
      string,
      { name: string; brand?: string; models: EmbeddingPickerModel[] }
    > = {}
    for (const model of pickerModels) {
      groups[model.providerId] ??= {
        name: model.providerName,
        brand: model.providerBrand,
        models: []
      }
      groups[model.providerId].models.push(model)
    }
    return groups
  }, [pickerModels])

  const builtInView = activeSourceId === BUILT_IN_SOURCE
  const activeProvider =
    activeSourceId && !builtInView ? providerGroups[activeSourceId] : undefined
  /** A source that vanished (advanced models hidden) falls back to every model. */
  const allView = !builtInView && !activeProvider
  const query = searchQuery.trim().toLocaleLowerCase()
  const showBuiltIn =
    (allView || builtInView) &&
    (!query || BUILT_IN_MODEL.toLocaleLowerCase().includes(query))

  /** Ordered as the chat list is; the built-in model stays pinned above. */
  const visibleModels = useMemo(() => {
    if (builtInView) return []
    const source = activeProvider ? activeProvider.models : pickerModels
    return source
      .filter((model) =>
        query ? model.name.toLocaleLowerCase().includes(query) : true
      )
      .sort((left, right) =>
        compareModelNames(
          sortDirection,
          left.name,
          right.name,
          left.providerName.localeCompare(right.providerName, "en")
        )
      )
  }, [activeProvider, builtInView, pickerModels, query, sortDirection])

  const rowCount = visibleModels.length + (showBuiltIn ? 1 : 0)
  const disabled =
    !nativeState || native.busy || migrating || rebuild.isRebuilding

  const handleBuiltInSelect = () => {
    if (disabled) return
    /** Picking the source already in use withdraws a pending switch away from it. */
    setPendingModel(null)
    setPendingSwitch(activeMode === "bundled" ? null : "start")
  }

  const handleModelSelect = (model: EmbeddingPickerModel) => {
    if (disabled) return
    if (activeMode === "bundled") {
      setPendingModel({ name: model.name, providerId: model.providerId })
      setPendingSwitch("external")
      return
    }
    setPendingSwitch(null)
    setPendingModel(null)
    rebuild.requestModelChange(model.name, model.providerId)
  }

  const confirmSwitch = () => {
    if (!pendingSwitch) return
    const action = pendingSwitch
    const staged = action === "external" ? pendingModel : null
    cancelSwitch()
    void (async () => {
      if (staged) {
        /**
         * "shared-model" so the rebuild reads the chosen provider, not the
         * "auto" chain; awaited because the background reads it from storage.
         */
        try {
          await settings.commitModelChange(
            staged.name,
            staged.providerId,
            "shared-model"
          )
        } catch (error) {
          logger.error("Embedding model save failed", "EmbeddingModelMenu", {
            error
          })
          return
        }
      }
      await native.command(action)
    })()
  }

  const cancelSwitch = () => {
    setPendingSwitch(null)
    setPendingModel(null)
  }

  const selectSource = (id: string | null) => {
    setActiveSourceId(id)
    setSearchQuery("")
  }

  const hasError =
    !!nativeState && (native.error || nativeState.migration === "changed")
  const errorText = t(
    nativeState?.migration === "changed"
      ? "settings.embeddings.bundled.changed"
      : "settings.embeddings.bundled.error"
  )
  const showFooter =
    !!nativeState &&
    (migrating ||
      native.busy ||
      hasError ||
      rebuild.isRebuilding ||
      !!rebuild.error ||
      (!!pendingSwitch && !migrating))

  return (
    <div className="flex h-96 min-h-0 overflow-hidden rounded-b-panel bg-popover text-popover-foreground">
      <nav
        aria-label={t("settings.embeddings.model_select.label")}
        className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-hidden border-r border-border bg-surface-sunken p-1.5">
        <RailButton
          label={t("model.menu.models_label")}
          selected={allView}
          onClick={() => selectSource(null)}>
          <Layers3 className="icon-md" />
        </RailButton>
        <RailDivider />
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-none">
          <RailButton
            label={t("settings.embeddings.bundled.mode_bundled")}
            ariaLabel={t("settings.embeddings.bundled.title")}
            selected={builtInView}
            onClick={() => selectSource(BUILT_IN_SOURCE)}>
            <Cpu className="icon-md" />
            {activeMode === "bundled" && <SelectedSourceDot />}
          </RailButton>
          {Object.entries(providerGroups).map(([providerId, group]) => (
            <RailButton
              key={providerId}
              label={`${group.name} · ${group.models.length}`}
              ariaLabel={group.name}
              selected={activeSourceId === providerId}
              onClick={() => selectSource(providerId)}>
              <ProviderIcon
                providerId={providerId}
                brand={group.brand}
                fallbackName={group.name}
                iconUrl={providerIcons[providerId]}
                className="icon-md"
              />
              {activeMode === "external" &&
                providerId === selectedProviderId && <SelectedSourceDot />}
            </RailButton>
          ))}
        </div>
        {railFooter}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col p-1">
        <MenuListHeader
          title={
            builtInView
              ? t("settings.embeddings.bundled.mode_bundled")
              : activeProvider?.name || t("model.menu.models_label")
          }
          count={rowCount}
          sortDirection={sortDirection}
          onSort={
            builtInView
              ? undefined
              : () =>
                  setSortDirection((current) =>
                    current === "asc" ? "desc" : "asc"
                  )
          }
          onRefresh={() => void settings.refresh()}
          refreshing={isLoading}>
          {!builtInView && settings.hasAdvancedModels && (
            <TooltipActionButton
              variant="ghost"
              size="icon"
              aria-pressed={showAdvanced}
              className={cn(
                "size-7",
                showAdvanced && "bg-state-selected text-foreground"
              )}
              ariaLabel={t(
                "settings.embeddings.model_select.show_advanced_label"
              )}
              tooltip={t(
                showAdvanced
                  ? "settings.embeddings.model_select.show_recommended_tooltip"
                  : "settings.embeddings.model_select.show_all_tooltip"
              )}
              onClick={() =>
                settings.updateConfig({
                  showAdvancedEmbeddingModels: !showAdvanced
                })
              }
              icon={<SlidersHorizontal className="icon-sm" />}
            />
          )}
        </MenuListHeader>

        <MenuSearch
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />

        <div className="min-h-0 flex-1 border-t border-border pt-1">
          {rowCount === 0 ? (
            <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
              {query
                ? t("model.menu.no_model_match")
                : isLoading
                  ? t("common.loading")
                  : t("model.menu.no_model_found")}
            </div>
          ) : (
            <div className="h-full overflow-y-auto scrollbar-none px-1 pb-1">
              {showBuiltIn && (
                <div className="mb-0.5 rounded-control">
                  <ListRow
                    density="compact"
                    inset="nested"
                    trailingKind="control"
                    active={
                      activeMode === "bundled" || pendingSwitch === "start"
                    }
                    leading={
                      <div className="flex size-7 shrink-0 items-center justify-center">
                        <Cpu
                          aria-hidden="true"
                          className="icon-sm text-muted-foreground"
                        />
                      </div>
                    }
                    trailing={
                      <RowStatus
                        state={
                          activeMode === "bundled"
                            ? "in-use"
                            : pendingSwitch === "start"
                              ? "selected"
                              : null
                        }
                      />
                    }>
                    <ListRowTitleButton
                      disabled={disabled}
                      onClick={handleBuiltInSelect}
                      title={t("settings.embeddings.bundled.mode_bundled_help")}
                      className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium">
                        {BUILT_IN_MODEL}
                      </span>
                      <span className="shrink-0 text-micro text-muted-foreground">
                        {t("settings.embeddings.bundled.mode_bundled")}
                      </span>
                    </ListRowTitleButton>
                  </ListRow>
                </div>
              )}
              {visibleModels.map((model) => {
                const selected =
                  model.providerId === selectedProviderId &&
                  model.name === selectedModel
                const current = selected && activeMode === "external"
                return (
                  <div
                    key={`${model.providerId}:${model.name}`}
                    className="mb-0.5 rounded-control">
                    <ListRow
                      density="compact"
                      inset="nested"
                      trailingKind="control"
                      active={
                        current || (selected && pendingSwitch === "external")
                      }
                      leading={
                        <div className="flex size-7 shrink-0 items-center justify-center">
                          <ProviderIcon
                            providerId={model.providerId}
                            brand={model.providerBrand}
                            fallbackName={model.providerName}
                            iconUrl={providerIcons[model.providerId]}
                            className="icon-sm text-muted-foreground"
                          />
                        </div>
                      }
                      trailing={
                        <RowStatus
                          state={
                            current
                              ? indexMatch === false
                                ? "not-indexed"
                                : "in-use"
                              : selected && pendingSwitch === "external"
                                ? "selected"
                                : null
                          }
                        />
                      }>
                      <ListRowTitleButton
                        disabled={disabled}
                        onClick={() => handleModelSelect(model)}
                        className="flex min-w-0 items-center gap-1.5">
                        {/*
                         * The provider is shown by the row's mark, so the
                         * title spends its width on the model. The mark sits
                         * outside the button, so in the all-models view the
                         * name stays in the button's text for assistive tech,
                         * where two providers can offer the same model.
                         */}
                        <span
                          className="truncate text-xs font-medium"
                          title={
                            allView
                              ? `${model.name} · ${model.providerName}`
                              : model.name
                          }>
                          {model.name}
                        </span>
                        {allView && (
                          <span className="sr-only">{model.providerName}</span>
                        )}
                      </ListRowTitleButton>
                    </ListRow>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {showFooter && nativeState && (
          <div className="space-y-1.5 border-t border-border px-2 py-2">
            {migrating && (
              <>
                <output className="block text-micro tabular-nums">
                  {t("settings.embeddings.bundled.progress", {
                    current: nativeState.current,
                    total: nativeState.total
                  })}
                </output>
                <Progress
                  value={
                    nativeState.total
                      ? (100 * nativeState.current) / nativeState.total
                      : 0
                  }
                />
              </>
            )}
            {rebuild.isRebuilding && (
              <>
                <output className="block text-micro tabular-nums">
                  {t("settings.context.embedding_health.progress", {
                    current: rebuild.progress?.current ?? 0,
                    total: rebuild.progress?.total ?? 0
                  })}
                </output>
                <Progress
                  value={
                    rebuild.progress?.total
                      ? (100 * rebuild.progress.current) /
                        rebuild.progress.total
                      : 0
                  }
                />
              </>
            )}
            {rebuild.error && !rebuild.isRebuilding && (
              <p
                className="line-clamp-2 text-micro text-destructive"
                role="alert">
                {t("settings.context.embedding_health.error")}
              </p>
            )}
            {hasError && (
              <p
                className="line-clamp-2 text-micro text-destructive"
                role="alert"
                title={errorText}>
                {errorText}
              </p>
            )}
            {pendingSwitch && !migrating && (
              <p className="text-micro text-muted-foreground">
                {t("settings.embeddings.bundled.switch_note")}
              </p>
            )}
            <div className="flex gap-1.5">
              {pendingSwitch && !migrating && (
                <>
                  <Button
                    size="sm"
                    className="min-w-0 flex-1"
                    disabled={native.busy}
                    title={t(
                      pendingSwitch === "start"
                        ? "settings.embeddings.bundled.switch_builtin"
                        : "settings.embeddings.bundled.switch_server"
                    )}
                    onClick={confirmSwitch}>
                    <span className="truncate">
                      {t("settings.embeddings.bundled.switch_to", {
                        model:
                          pendingSwitch === "start"
                            ? `${BUILT_IN_MODEL} (${t("settings.embeddings.bundled.mode_bundled")})`
                            : selectedModel
                      })}
                    </span>
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelSwitch}>
                    {t("common.cancel")}
                  </Button>
                </>
              )}
              {migrating && nativeState.failed && (
                <Button
                  size="sm"
                  disabled={native.busy}
                  onClick={() => void native.command("resume")}>
                  {t("settings.embeddings.bundled.resume")}
                </Button>
              )}
              {(migrating || native.busy) && !pendingSwitch && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void native.command("cancel")}>
                  {t("common.cancel")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <EmbeddingRebuildDialogs
        confirmRebuildOpen={rebuild.confirmRebuildOpen}
        onConfirmRebuildOpenChange={rebuild.setConfirmRebuildOpen}
        onConfirmRebuild={rebuild.rebuild}
        modelChangeOpen={rebuild.modelChangeOpen}
        onModelChangeOpenChange={rebuild.setModelChangeOpen}
        onSwitchOnly={rebuild.switchModel}
        onSwitchAndRebuild={rebuild.switchModelAndRebuild}
      />
    </div>
  )
}
