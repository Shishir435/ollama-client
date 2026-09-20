import type { ReactNode } from "react"

import { PerformanceWarning } from "@/components/performance-warning"
import { SettingsButton } from "@/components/settings-button"
import { SetupGuideLink } from "@/components/setup-guide-link"
import { SocialHandles } from "@/components/social-handles"
import { StartChatButton } from "@/components/start-chat-button"
import { FeatureGrid } from "./welcome/feature-grid"
import { HeroCard } from "./welcome/hero-card"
import { StatusCard } from "./welcome/status-card"

/**
 * The panel before there is a chat to show.
 *
 * It takes the surface switch too, because this screen replaces the composer
 * rather than sitting beside it: the switch lives in the composer's control
 * row, and on a fresh install there is no composer, so the Agent was
 * unreachable until the user had started a chat they did not want.
 */
export const WelcomeScreen = ({ leading }: { leading?: ReactNode }) => {
  return (
    <div className="flex w-full flex-col items-center justify-start overflow-auto rounded-b-lg rounded-t-2xl bg-background px-4 py-6 text-foreground scrollbar-none">
      <HeroCard />

      <StatusCard />

      <div className="mb-4 flex w-full max-w-xl gap-3">
        <StartChatButton className="flex-1" />
        {leading && <div className="flex shrink-0 items-center">{leading}</div>}
        <div className="flex shrink-0 items-stretch">
          <SettingsButton
            variant="outline"
            className="h-full px-5 font-medium text-base text-foreground shadow-sm transition-all duration-300 hover:bg-state-hover"
            iconClassName="icon-lg"
          />
        </div>
      </div>

      <div className="mb-8 flex w-full max-w-xl items-center justify-center">
        <SetupGuideLink />
      </div>

      <FeatureGrid />

      <div className="mb-4 w-full max-w-xl">
        <PerformanceWarning />
      </div>

      <div className="mb-2 transform transition-transform hover:scale-105">
        <SocialHandles />
      </div>
    </div>
  )
}
