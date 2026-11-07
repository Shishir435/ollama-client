import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const stores = vi.hoisted(() => ({
  sessions: vi.fn(),
  messages: vi.fn(),
  vectors: vi.fn(),
  files: vi.fn(),
  runs: vi.fn()
}))

vi.mock("react-i18next", () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key
  return { useTranslation: () => ({ t }) }
})
vi.mock("@/lib/repositories/chat-history", () => ({
  getAllSessions: stores.sessions,
  countMessages: stores.messages
}))
vi.mock("@/lib/embeddings/vector-store", () => ({
  getStorageStats: stores.vectors
}))
vi.mock("@/lib/knowledge/knowledge-sets", () => ({
  knowledgeDb: { knowledgeFiles: { count: stores.files } }
}))
vi.mock("@/lib/repositories/agent-runs", () => ({
  countAgentRuns: stores.runs
}))

import { PrivacyDataInventory } from "../privacy-data-inventory"

describe("PrivacyDataInventory", () => {
  it("shows a loading state, never zero, until the counts arrive", async () => {
    stores.sessions.mockReturnValue(new Promise(() => {}))
    stores.messages.mockResolvedValue(0)
    stores.vectors.mockResolvedValue({ totalVectors: 0 })
    stores.files.mockResolvedValue(0)
    stores.runs.mockResolvedValue(0)
    render(<PrivacyDataInventory />)
    expect(
      screen.getAllByText("settings.privacy_spine.inventory.loading").length
    ).toBeGreaterThan(0)
    expect(screen.queryByText(/chat_count/)).toBeNull()
  })

  it("says it could not read the counts when a store fails", async () => {
    stores.sessions.mockRejectedValue(new Error("db down"))
    stores.messages.mockResolvedValue(0)
    stores.vectors.mockResolvedValue({ totalVectors: 0 })
    stores.files.mockResolvedValue(0)
    stores.runs.mockResolvedValue(0)
    render(<PrivacyDataInventory />)
    await waitFor(() =>
      expect(
        screen.getAllByText("settings.privacy_spine.inventory.unavailable")
          .length
      ).toBeGreaterThan(0)
    )
  })
})
