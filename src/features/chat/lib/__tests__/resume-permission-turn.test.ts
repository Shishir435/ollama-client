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
      missingPermissions: ["bookmarks"],
      resume: {
        version: 1,
        turnId: "turn-1",
        model: "llama3",
        providerId: "ollama",
        createdAt: 123,
        context: {
          files: [
            {
              text: "file body",
              metadata: { fileName: "notes.txt", fileId: "file-1" }
            }
          ],
          hasTabContext: true,
          contextText: "selected page body",
          tabDocuments: [
            { id: "tab-1", title: "Selected page", content: "page body" }
          ],
          memoryEnabled: true,
          maxTabContextChars: 4000,
          maxRagContextChars: 4000,
          groundedOnlyMode: false,
          selectedModel: "llama3",
          selectedModelRef: { providerId: "ollama", modelId: "llama3" }
        }
      }
    }
  }
}
const laterUser: ChatMessage = {
  id: 3,
  parentId: 2,
  role: "user",
  content: "A later question"
}
const laterAssistant: ChatMessage = {
  id: 4,
  parentId: 3,
  role: "assistant",
  content: "A later answer",
  done: true
}

const setup = () => ({
  message: notice,
  messages: [user, notice, laterUser, laterAssistant],
  sessionId: "session-1",
  requestPermissions: vi.fn().mockResolvedValue(true),
  claimStream: vi.fn(() => Symbol("claim")),
  releaseStreamClaim: vi.fn(),
  updateMessage: vi.fn().mockResolvedValue(undefined),
  navigateToNode: vi.fn().mockResolvedValue(undefined),
  generateResponse: vi.fn().mockResolvedValue(true)
})

describe("resumePermissionTurn", () => {
  it("resolves the notice without deleting its later conversation", async () => {
    const options = setup()

    await expect(resumePermissionTurn(options)).resolves.toBe("started")

    expect(options.requestPermissions).toHaveBeenCalledWith(["bookmarks"])
    expect(options.updateMessage).toHaveBeenCalledWith(2, {
      metrics: expect.objectContaining({
        permissionNotice: expect.objectContaining({
          resolvedAt: expect.any(Number),
          resume: undefined
        })
      })
    })
    expect(options.navigateToNode).toHaveBeenCalledWith("session-1", 1, true)
    expect(options.generateResponse).toHaveBeenCalledWith(
      "llama3",
      "session-1",
      [user],
      expect.objectContaining({
        mode: "regenerate",
        durableTurn: expect.objectContaining({
          submission: expect.objectContaining({
            id: "turn-1",
            mode: "new",
            providerId: "ollama",
            request: expect.objectContaining({
              context: expect.objectContaining({
                files: expect.arrayContaining([
                  expect.objectContaining({ text: "file body" })
                ]),
                hasTabContext: true,
                contextText: "selected page body",
                tabDocuments: expect.arrayContaining([
                  expect.objectContaining({
                    id: "tab-1",
                    content: "page body"
                  })
                ])
              })
            })
          })
        })
      })
    )
    expect(options.generateResponse.mock.invocationCallOrder[0]).toBeLessThan(
      options.updateMessage.mock.invocationCallOrder[0]
    )
  })

  it("keeps the notice when permission is denied", async () => {
    const options = setup()
    options.requestPermissions.mockResolvedValue(false)

    await expect(resumePermissionTurn(options)).resolves.toBe(
      "permission-denied"
    )
    expect(options.claimStream).not.toHaveBeenCalled()
    expect(options.updateMessage).not.toHaveBeenCalled()
    expect(options.generateResponse).not.toHaveBeenCalled()
  })

  it("restores the notice when resume is rejected", async () => {
    const options = setup()
    options.generateResponse.mockResolvedValue(false)

    await expect(resumePermissionTurn(options)).resolves.toBe("resume-failed")
    expect(options.updateMessage).not.toHaveBeenCalled()
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
    expect(options.updateMessage).not.toHaveBeenCalled()
    expect(options.navigateToNode).toHaveBeenLastCalledWith(
      "session-1",
      2,
      true
    )
    expect(options.releaseStreamClaim).toHaveBeenCalledWith(expect.any(Symbol))
  })
})
