import { PerformanceWarning } from "@/components/performance-warning"
import { SettingsButton } from "@/components/settings-button"
import { SetupGuideLink } from "@/components/setup-guide-link"
import { SocialHandles } from "@/components/social-handles"
import { StartChatButton } from "@/components/start-chat-button"
import { FeatureGrid } from "./welcome/feature-grid"
import { HeroSection } from "./welcome/hero-section"
import { StatusCard } from "./welcome/status-card"

export const WelcomeScreen = () => {
  return (
    <div className="flex w-full flex-col items-center justify-start overflow-auto rounded-b-lg rounded-t-2xl bg-background px-4 py-6 text-foreground scrollbar-none">
      <HeroSection />

      <StatusCard />

      <div className="mb-4 flex w-full max-w-xl gap-3">
        <StartChatButton className="flex-1" />
        <div className="flex shrink-0 items-stretch">
          <SettingsButton
            variant="outline"
            className="h-full rounded-xl px-5 font-medium shadow-sm transition-all duration-300 hover:bg-muted/50 text-base"
            iconClassName="h-5 w-5"
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
