import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "@/types"
import { resumePermissionTurn } from "../resume-permission-turn"

const user: ChatMessage = { id: 1, role: "user", content: "My bookmarks" }
const notice: ChatMessage = {
  id: 2,
  role: "assistant",
  content: "Bookmarks access is disabled.",
  model: "llama3",
  done: true,
  metrics: {
    permissionNotice: {
      capabilityId: "bookmarks",
      focusId: "permission-bookmarks",
      labelKey: "settings.permissions.items.bookmarks.label",
      missingPermissions: ["bookmarks"]
    }
  }
}

const setup = () => ({
  message: notice,
  messages: [user, notice],
  sessionId: "session-1",
  requestPermissions: vi.fn().mockResolvedValue(true),
  claimStream: vi.fn(() => Symbol("claim")),
  releaseStreamClaim: vi.fn(),
  deleteMessage: vi.fn().mockResolvedValue(undefined),
  navigateToNode: vi.fn().mockResolvedValue(undefined),
  generateResponse: vi.fn().mockResolvedValue(true)
})

describe("resumePermissionTurn", () => {
  it("removes the notice and resumes the original request after permission", async () => {
    const options = setup()

    await expect(resumePermissionTurn(options)).resolves.toBe(true)

    expect(options.requestPermissions).toHaveBeenCalledWith(["bookmarks"])
    expect(options.deleteMessage).toHaveBeenCalledWith(2)
    expect(options.navigateToNode).toHaveBeenCalledWith("session-1", 1, true)
    expect(options.generateResponse).toHaveBeenCalledWith(
      "llama3",
      "session-1",
      [user],
      expect.objectContaining({ mode: "regenerate" })
    )
  })

  it("keeps the notice when permission is denied", async () => {
    const options = setup()
    options.requestPermissions.mockResolvedValue(false)

    await expect(resumePermissionTurn(options)).resolves.toBe(false)
    expect(options.claimStream).not.toHaveBeenCalled()
    expect(options.deleteMessage).not.toHaveBeenCalled()
    expect(options.generateResponse).not.toHaveBeenCalled()
  })

  it("releases stream ownership when resume is rejected", async () => {
    const options = setup()
    options.generateResponse.mockResolvedValue(false)

    await expect(resumePermissionTurn(options)).resolves.toBe(false)
    expect(options.releaseStreamClaim).toHaveBeenCalledWith(expect.any(Symbol))
  })
})
