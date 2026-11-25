import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { openOptionsInTab } from "@/lib/browser-api"
import type { ChatMessage } from "@/types"
import {
  ContextTrimmedNotice,
  wasPageContextTrimmed
} from "../context-trimmed-notice"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: vi.fn(),
  runtime: { getURL: (path: string) => `chrome-extension://test/${path}` }
}))

const assistant = (tabContextTruncated?: boolean): ChatMessage => ({
  role: "assistant",
  content: "Answer",
  metrics: { tabContextTruncated }
})

describe("page-trimmed notice", () => {
  it("is shown only for an answer whose page text was cut", () => {
    expect(wasPageContextTrimmed(assistant(true))).toBe(true)
    expect(wasPageContextTrimmed(assistant(false))).toBe(false)
    expect(wasPageContextTrimmed(assistant(undefined))).toBe(false)
    expect(wasPageContextTrimmed({ ...assistant(true), role: "user" })).toBe(
      false
    )
  })

  it("links to the context size setting", () => {
    render(<ContextTrimmedNotice />)

    expect(screen.getByText("chat.context.trimmed")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "chat.context.trimmed_action" })
    )

    expect(openOptionsInTab).toHaveBeenCalledWith(
      "chrome-extension://test/options.html?tab=models&focus=num-ctx"
    )
  })
})
