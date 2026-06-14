import { describe, expect, it, vi } from "vitest"

import { sendTranscriptOnlyResponse } from "../extraction-debug"

describe("sendTranscriptOnlyResponse", () => {
  it("keeps video metadata before transcript context", () => {
    const sendResponse = vi.fn()

    const sent = sendTranscriptOnlyResponse({
      sendResponse,
      currentUrl: "https://www.youtube.com/watch?v=abc",
      pageTitle: "Video title",
      transcript: "0:00 hello",
      platform: "youtube",
      missingMessage: "No transcript found.",
      metadata:
        "Video URL: https://www.youtube.com/watch?v=abc\nTitle: Video title\nChannel: Test Channel\nLikes: 10 likes\nDislikes: unavailable\nTranscript:"
    })

    expect(sent).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("Channel: Test Channel")
      })
    )
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("0:00 hello")
      })
    )
  })
})
