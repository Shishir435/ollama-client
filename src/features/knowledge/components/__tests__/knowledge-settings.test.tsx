import { useStorage } from "@plasmohq/storage/hook"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { knowledgeConfig } from "@/lib/config/knowledge-config"
import { DEFAULT_EMBEDDING_CONFIG, type EmbeddingConfig } from "@/lib/constants"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { FeedbackSettings } from "../feedback-settings"
import { TextSplittingSettings } from "../text-splitting-settings"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

vi.mock("@/components/settings", () => ({
  ConfirmActionDialog: ({
    open,
    title,
    confirmLabel,
    onConfirm
  }: {
    open: boolean
    title: string
    confirmLabel?: string
    onConfirm: () => void | Promise<void>
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={onConfirm}>
          {confirmLabel ?? "common.continue"}
        </button>
      </div>
    ) : null,
  SettingsCard: ({
    title,
    children
  }: {
    title: string
    children: React.ReactNode
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  SettingsField: ({
    label,
    children
  }: {
    label: React.ReactNode
    children?: React.ReactNode
  }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
  SettingsFormField: ({
    label,
    children
  }: {
    label: React.ReactNode
    children?: React.ReactNode
  }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
  SettingsSliderField: ({
    label,
    value,
    step = 1,
    onValueChange
  }: {
    label: React.ReactNode
    value: number
    step?: number
    onValueChange: (value: number) => void
  }) => (
    <button type="button" onClick={() => onValueChange(value + step)}>
      {label}
    </button>
  ),
  SettingsSwitch: ({
    label,
    checked,
    onCheckedChange
  }: {
    label: React.ReactNode
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}>
      {label}
    </button>
  )
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() })
}))

vi.mock("@/lib/config/knowledge-config", () => ({
  knowledgeConfig: {
    setChunkSize: vi.fn().mockResolvedValue(undefined),
    setChunkOverlap: vi.fn().mockResolvedValue(undefined),
    setSplittingStrategy: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("@/lib/embeddings/feedback-service", () => ({
  feedbackService: {
    getStatistics: vi.fn(),
    exportFeedback: vi.fn(),
    clearAllFeedback: vi.fn()
  }
}))

const storageControls = {
  setRenderValue: vi.fn(),
  setStoreValue: vi.fn().mockResolvedValue(null),
  remove: vi.fn(),
  isLoading: false
}

const mockStorage = (config: EmbeddingConfig, setter = vi.fn()) => {
  vi.mocked(useStorage).mockReturnValue([config, setter, storageControls])
  return setter
}

describe("knowledge settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(feedbackService.getStatistics).mockResolvedValue({
      totalFeedback: 2,
      helpfulPercentage: 50,
      uniqueChunks: 2,
      uniqueQueries: 1
    })
    vi.mocked(feedbackService.exportFeedback).mockResolvedValue([])
    vi.mocked(feedbackService.clearAllFeedback).mockResolvedValue(undefined)
  })

  it("syncs text splitting config and persists enhanced chunking changes", async () => {
    const setConfig = mockStorage({
      ...DEFAULT_EMBEDDING_CONFIG,
      useEnhancedChunking: true,
      chunkSize: 700,
      chunkOverlap: 80
    })

    render(<TextSplittingSettings />)

    await waitFor(() => {
      expect(knowledgeConfig.setChunkSize).toHaveBeenCalledWith(700)
      expect(knowledgeConfig.setChunkOverlap).toHaveBeenCalledWith(80)
      expect(knowledgeConfig.setSplittingStrategy).toHaveBeenCalledWith(
        "recursive"
      )
    })

    fireEvent.click(
      screen.getByRole("switch", {
        name: /model.embedding_config.enhanced_chunking_label/
      })
    )

    const update = setConfig.mock.calls.at(-1)?.[0]
    expect(typeof update).toBe("function")
    expect(update(DEFAULT_EMBEDDING_CONFIG)).toEqual(
      expect.objectContaining({ useEnhancedChunking: false })
    )
  })

  it("persists feedback toggles and clears feedback after confirmation", async () => {
    const setConfig = mockStorage({
      ...DEFAULT_EMBEDDING_CONFIG,
      feedbackEnabled: true,
      showRetrievedChunks: true
    })

    render(<FeedbackSettings />)

    expect(await screen.findAllByText("2")).toHaveLength(2)

    fireEvent.click(
      screen.getByRole("switch", {
        name: /model.embedding_config.feedback_enable_label/
      })
    )
    const feedbackUpdate = setConfig.mock.calls.at(-1)?.[0]
    expect(typeof feedbackUpdate).toBe("function")
    expect(feedbackUpdate(DEFAULT_EMBEDDING_CONFIG)).toEqual(
      expect.objectContaining({ feedbackEnabled: false })
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: /model.embedding_config.feedback_clear_button/
      })
    )
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /model.embedding_config.feedback_clear_button/
      })
    )

    await waitFor(() => {
      expect(feedbackService.clearAllFeedback).toHaveBeenCalled()
    })
  })
})
