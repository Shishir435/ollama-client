import { isChromiumBased } from "@/lib/browser-api"
import {
  applyProviderOriginRules,
  clearProviderOriginRules,
  providerOrigins
} from "@/lib/dnr-rules"
import {
  clearStrippedProviderOrigins,
  setStrippedProviderOrigins,
  supportsOriginStripListener
} from "@/lib/firefox-origin-guard"
import { logger } from "@/lib/logger"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { ProviderManager } from "@/lib/providers/manager"
import type { ProviderConfig } from "@/lib/providers/types"

const configuredBaseUrls = (providers: readonly ProviderConfig[]): string[] =>
  providers.flatMap((config) => {
    try {
      return [resolveProviderBaseUrl(config)]
    } catch {
      return []
    }
  })

/**
 * Firefox has no DNR; its listener takes the same origin set. A failure
 * empties the set, which strips nothing — never everything.
 */
const updateFirefoxOriginGuard = async (): Promise<void> => {
  if (!supportsOriginStripListener()) {
    logger.warn(
      "Origin guard unavailable: provider requests keep their Origin header",
      "DNR"
    )
    return
  }
  try {
    const providers = await ProviderManager.getProviders()
    setStrippedProviderOrigins(configuredBaseUrls(providers))
  } catch (error) {
    logger.error("Failed to update the Origin guard", "DNR", { error })
    clearStrippedProviderOrigins()
  }
}

const reconcileOriginGuard = async (): Promise<void> => {
  if (!isChromiumBased()) {
    await updateFirefoxOriginGuard()
    return
  }
  try {
    const providers = await ProviderManager.getProviders()
    await applyProviderOriginRules(
      providerOrigins(configuredBaseUrls(providers))
    )
  } catch (error) {
    logger.error("Failed to update DNR rules", "DNR", { error })
    /**
     * Fail closed. Keeping whatever is installed would keep an older
     * version's unrestricted rule through an upgrade whose first reconcile
     * failed, and that rule lets any website reach the user's providers past
     * their origin check. The next storage change or boot reconciles again.
     */
    try {
      await clearProviderOriginRules()
    } catch (clearError) {
      logger.error("Failed to clear DNR rules", "DNR", { error: clearError })
    }
  }
}

/**
 * Startup, `onStartup` and every provider-config change reconcile, and they
 * overlap. Each reads the provider list and then writes, so two running side
 * by side could read old-then-new and write new-then-old, leaving the older
 * set installed. Running each whole reconcile — read included — after the
 * previous one keeps the last write the newest read.
 */
let reconciles: Promise<void> = Promise.resolve()

/**
 * Reconcile the Origin rules with every configured provider, enabled or not:
 * enabling a provider is a storage change that reconciles again anyway, and a
 * disabled one can still be tested from settings.
 */
export const updateDNRRules = (): Promise<void> => {
  const next = reconciles.then(reconcileOriginGuard, reconcileOriginGuard)
  reconciles = next.catch(() => undefined)
  return next
}
