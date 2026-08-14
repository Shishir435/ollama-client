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
  it("removes the notice only after replacement generation starts", async () => {
    const options = setup()

    await expect(resumePermissionTurn(options)).resolves.toBe("started")

    expect(options.requestPermissions).toHaveBeenCalledWith(["bookmarks"])
    expect(options.deleteMessage).toHaveBeenCalledWith(2)
    expect(options.navigateToNode).toHaveBeenCalledWith("session-1", 1, true)
    expect(options.generateResponse).toHaveBeenCalledWith(
      "llama3",
      "session-1",
      [user],
      expect.objectContaining({ mode: "regenerate" })
    )
    expect(options.generateResponse.mock.invocationCallOrder[0]).toBeLessThan(
      options.deleteMessage.mock.invocationCallOrder[0]
    )
  })

  it("keeps the notice when permission is denied", async () => {
    const options = setup()
    options.requestPermissions.mockResolvedValue(false)

    await expect(resumePermissionTurn(options)).resolves.toBe(
      "permission-denied"
    )
    expect(options.claimStream).not.toHaveBeenCalled()
    expect(options.deleteMessage).not.toHaveBeenCalled()
    expect(options.generateResponse).not.toHaveBeenCalled()
  })

  it("restores the notice when resume is rejected", async () => {
    const options = setup()
    options.generateResponse.mockResolvedValue(false)

    await expect(resumePermissionTurn(options)).resolves.toBe("resume-failed")
    expect(options.deleteMessage).not.toHaveBeenCalled()
    expect(options.navigateToNode).toHaveBeenLastCalledWith(
      "session-1",
      2,
      true
    )
    expect(options.releaseStreamClaim).toHaveBeenCalledWith(expect.any(Symbol))
  })

  it("restores the notice when replacement generation throws", async () => {
    const options = setup()
    options.generateResponse.mockRejectedValue(new Error("stream failed"))

    await expect(resumePermissionTurn(options)).resolves.toBe("resume-failed")
    expect(options.deleteMessage).not.toHaveBeenCalled()
    expect(options.navigateToNode).toHaveBeenLastCalledWith(
      "session-1",
      2,
      true
    )
    expect(options.releaseStreamClaim).toHaveBeenCalledWith(expect.any(Symbol))
  })
})
