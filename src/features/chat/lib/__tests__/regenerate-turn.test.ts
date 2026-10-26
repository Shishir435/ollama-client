import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ hydrateMessageImages: vi.fn() }))

vi.mock("@/features/sessions/lib/image-bytes", () => ({
  hydrateMessageImages: mocks.hydrateMessageImages
}))

import type { ChatMessage } from "@/types"
import { regenerateTurn } from "../regenerate-turn"

/** user 1 → old answer 2 → user 3 → answer 4: the tip is 4. */
const path: ChatMessage[] = [
  { id: 1, role: "user", content: "first" },
  { id: 2, role: "assistant", content: "old answer" },
  { id: 3, role: "user", content: "second" },
  { id: 4, role: "assistant", content: "latest answer" }
]
const claim = Symbol("claim")

const setup = () => {
  const navigateToNode = vi.fn().mockResolvedValue(undefined)
  const generateResponse = vi.fn().mockResolvedValue(true)
  const releaseStreamClaim = vi.fn()
  const run = (overrides: Partial<Parameters<typeof regenerateTurn>[0]> = {}) =>
    regenerateTurn({
      message: path[1],
      messages: path,
      sessionId: "s1",
      claimStream: () => claim,
      releaseStreamClaim,
      navigateToNode,
      generateResponse,
      ...overrides
    })
  return { navigateToNode, generateResponse, releaseStreamClaim, run }
}

describe("regenerateTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hydrateMessageImages.mockImplementation(async (m: ChatMessage[]) => m)
  })

  it("rewinds to the user message and submits with that context", async () => {
    const { navigateToNode, generateResponse, releaseStreamClaim, run } =
      setup()

    await run({ model: "other" })

    expect(navigateToNode).toHaveBeenCalledOnce()
    expect(navigateToNode).toHaveBeenCalledWith("s1", 1, true)
    expect(generateResponse).toHaveBeenCalledWith("other", "s1", [path[0]], {
      mode: "regenerate",
      streamClaim: claim
    })
    expect(releaseStreamClaim).not.toHaveBeenCalled()
  })

  it("puts the branch back at its tip, not at the answer, when submitting fails", async () => {
    const { navigateToNode, generateResponse, releaseStreamClaim, run } =
      setup()
    generateResponse.mockRejectedValue(new Error("provider down"))

    await expect(run()).rejects.toThrow("provider down")

    expect(navigateToNode.mock.calls).toEqual([
      ["s1", 1, true],
      ["s1", 4, true]
    ])
    expect(releaseStreamClaim).toHaveBeenCalledWith(claim)
  })

  it("restores the tip when the stream is refused without an error", async () => {
    const { navigateToNode, generateResponse, run } = setup()
    generateResponse.mockResolvedValue(false)

    await run()

    expect(navigateToNode.mock.calls.at(-1)).toEqual(["s1", 4, true])
  })

  it("does not move the branch at all when reading images fails", async () => {
    const { navigateToNode, generateResponse, releaseStreamClaim, run } =
      setup()
    mocks.hydrateMessageImages.mockRejectedValue(new Error("bytes gone"))

    await expect(run()).rejects.toThrow("bytes gone")

    expect(navigateToNode).not.toHaveBeenCalled()
    expect(generateResponse).not.toHaveBeenCalled()
    expect(releaseStreamClaim).toHaveBeenCalledWith(claim)
  })

  it("does nothing without a claim, a session or a user message to answer", async () => {
    const { navigateToNode, generateResponse, run } = setup()

    await run({ claimStream: () => null })
    await run({ sessionId: null })
    await run({ message: path[0] })

    expect(navigateToNode).not.toHaveBeenCalled()
    expect(generateResponse).not.toHaveBeenCalled()
  })
})
