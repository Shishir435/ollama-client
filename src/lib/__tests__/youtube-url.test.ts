import { describe, expect, it } from "vitest"
import { getYouTubeVideoId, isYouTubeVideoPage } from "../youtube-url"

describe("YouTube video URLs", () => {
  it.each([
    ["https://www.youtube.com/watch?v=watch-id", "watch-id"],
    ["https://www.youtube.com/live/live-id?feature=share", "live-id"],
    ["https://youtube.com/shorts/short-id", "short-id"]
  ])("recognizes %s", (url, id) => {
    expect(getYouTubeVideoId(url)).toBe(id)
    expect(isYouTubeVideoPage(url)).toBe(true)
  })

  it.each([
    "https://www.youtube.com/",
    "https://example.com/watch?v=wrong-host",
    "not a url"
  ])("rejects %s", (url) => {
    expect(getYouTubeVideoId(url)).toBe("")
    expect(isYouTubeVideoPage(url)).toBe(false)
  })
})
