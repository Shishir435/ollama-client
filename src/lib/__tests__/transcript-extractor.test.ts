import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  extractYouTubeTranscript,
  extractUdemyTranscript,
  extractCourseraTranscript
} = vi.hoisted(() => ({
  extractYouTubeTranscript: vi.fn<() => Promise<string | null>>(),
  extractUdemyTranscript: vi.fn<() => Promise<string | null>>(),
  extractCourseraTranscript: vi.fn<() => string | null>()
}))

vi.mock("@/lib/transcripts/youtube", () => ({ extractYouTubeTranscript }))
vi.mock("@/lib/transcripts/udemy", () => ({ extractUdemyTranscript }))
vi.mock("@/lib/transcripts/coursera", () => ({ extractCourseraTranscript }))

import { getTranscript } from "../transcript-extractor"

describe("transcript dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    extractYouTubeTranscript.mockResolvedValue(null)
    extractUdemyTranscript.mockResolvedValue(null)
    extractCourseraTranscript.mockReturnValue(null)
  })

  it("returns the first platform transcript", async () => {
    extractYouTubeTranscript.mockResolvedValue("YouTube transcript")

    expect(await getTranscript()).toBe("YouTube transcript")
    expect(extractUdemyTranscript).not.toHaveBeenCalled()
    expect(extractCourseraTranscript).not.toHaveBeenCalled()
  })

  it("falls through platforms in the established order", async () => {
    extractUdemyTranscript.mockResolvedValue("Udemy transcript")

    expect(await getTranscript()).toBe("Udemy transcript")
    expect(extractYouTubeTranscript).toHaveBeenCalledOnce()
    expect(extractUdemyTranscript).toHaveBeenCalledOnce()
    expect(extractCourseraTranscript).not.toHaveBeenCalled()
  })

  it("returns null when no platform has a transcript", async () => {
    expect(await getTranscript()).toBeNull()
    expect(extractYouTubeTranscript).toHaveBeenCalledOnce()
    expect(extractUdemyTranscript).toHaveBeenCalledOnce()
    expect(extractCourseraTranscript).toHaveBeenCalledOnce()
  })
})
