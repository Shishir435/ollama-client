type NavigatorWithPlatformData = Navigator & {
  userAgentData?: { platform?: string }
}

/**
 * Whether the host is macOS, for choosing the modifier a shortcut hint names.
 * Reads `userAgentData` first because `navigator.platform` is deprecated.
 */
export const isMacPlatform = (): boolean => {
  if (typeof navigator === "undefined") return false
  const nav = navigator as NavigatorWithPlatformData
  return /mac/i.test(nav.userAgentData?.platform ?? nav.userAgent ?? "")
}
