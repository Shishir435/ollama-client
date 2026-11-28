import { useEffect } from "react"
import { useSetting } from "@/hooks/use-setting"
import { logger } from "@/lib/logger"
import {
  getOnboardingState,
  ONBOARDING_STATE_SETTING
} from "@/lib/onboarding/state"

/** Settings can mount before the sidepanel has migrated a legacy profile. */
export const useOnboardingState = () => {
  const [state] = useSetting(ONBOARDING_STATE_SETTING)
  useEffect(() => {
    if (!state)
      void getOnboardingState().catch(() =>
        logger.warn("Could not read onboarding state", "Onboarding")
      )
  }, [state])
  return state
}
