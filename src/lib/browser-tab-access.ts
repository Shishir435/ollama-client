/** URL schemes where a content script can run at all. */
export const isReadableTabScheme = (url?: string): boolean =>
  !!url && /^(https?|file|ftp):/i.test(url)

/** Browser-owned extension galleries block content scripts despite HTTPS. */
export const isExtensionGalleryUrl = (url?: string): boolean => {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.hostname === "chromewebstore.google.com" ||
    (parsed.hostname === "chrome.google.com" &&
      parsed.pathname.includes("/webstore"))
  )
}

export const isContentScriptReadableUrl = (url?: string): boolean =>
  isReadableTabScheme(url) && !isExtensionGalleryUrl(url)

export const blockedTabAccessMessage = (label: string): string =>
  `Can't read ${label} — the browser blocks extensions on internal pages and extension galleries (chrome://, Chrome Web Store, etc.). Do not retry this same tab; answer from visible tab metadata or ask the user to switch/share details.`
