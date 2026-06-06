export const isYouTubeWatchPage = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return (
      (parsed.hostname === "youtube.com" ||
        parsed.hostname.endsWith(".youtube.com")) &&
      parsed.pathname === "/watch" &&
      parsed.searchParams.has("v")
    )
  } catch {
    return url.includes("youtube.com/watch?v=")
  }
}

export const isUdemyLecturePage = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return (
      (parsed.hostname === "udemy.com" ||
        parsed.hostname.endsWith(".udemy.com")) &&
      parsed.pathname.includes("/course/") &&
      parsed.pathname.includes("/learn/lecture/")
    )
  } catch {
    return url.includes("udemy.com/course/") && url.includes("/learn/lecture/")
  }
}
