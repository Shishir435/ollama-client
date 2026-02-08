import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"

import { LanguageSelector } from "@/components/language-selector"
import { PerformanceWarning } from "@/components/performance-warning"
import {
  type NavSection,
  SettingsMobileNav,
  SettingsSidebar
} from "@/components/settings"
import { SocialHandles } from "@/components/social-handles"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { ChatDisplaySettings } from "@/features/chat/components/chat-display-settings"
import { SpeechSettings } from "@/features/chat/components/speech-settings"
import { MemorySettings } from "@/features/memory/components/memory-settings"
import { ContentExtractionSettings } from "@/features/model/components/content-extraction-settings"
import { EmbeddingSettings } from "@/features/model/components/embedding-settings"
import { ModelSettingsForm } from "@/features/model/components/model-settings-form"

import { ProviderSettings } from "@/features/model/components/provider-settings"
import { PromptTemplateManager } from "@/features/prompt/components/prompt-template-manager"
import {
  BookOpen,
  Brain,
  Database,
  FileText,
  RefreshCcw,
  Server,
  Settings,
  Sparkles,
  Volume2,
  Zap
} from "@/lib/lucide-icon"
import { Guides } from "@/options/components/guides"
import { ResetStorage } from "@/options/components/reset-storage"
import { ShortcutsSettings } from "@/options/components/shortcuts-settings"

export const SettingsPage = () => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState("general")

  const navSections: NavSection[] = [
    {
      title: t("settings.sections.app"),
      items: [
        { key: "general", label: t("settings.tabs.general"), icon: Settings },
        {
          key: "providers",
          label: t("settings.tabs.providers"),
          icon: Server,
          badge: "New"
        }
      ]
    },
    {
      title: t("settings.sections.ai_models"),
      items: [
        {
          key: "embeddings",
          label: t("settings.tabs.embeddings"),
          icon: Database,
          badge: "Beta"
        },
        {
          key: "memory",
          label: t("settings.tabs.memory"),
          icon: Brain,
          badge: "Beta"
        },
        {
          key: "contentExtraction",
          label: t("settings.tabs.extraction"),
          icon: Sparkles
        }
      ]
    },
    {
      title: t("settings.sections.customize"),
      items: [
        { key: "templates", label: t("settings.tabs.prompts"), icon: FileText },
        { key: "shortcuts", label: t("settings.tabs.shortcuts"), icon: Zap },
        { key: "voices", label: t("settings.tabs.voices"), icon: Volume2 }
      ]
    },
    {
      title: t("settings.sections.system"),
      items: [
        { key: "reset", label: t("settings.tabs.reset"), icon: RefreshCcw },
        { key: "setup", label: t("settings.tabs.guides"), icon: BookOpen }
      ]
    }
  ]

  const tabContent: Record<string, ReactNode> = {
    general: (
      <div className="space-y-6">
        <PerformanceWarning />
        <LanguageSelector />
        <ChatDisplaySettings />
        <ModelSettingsForm />
      </div>
    ),
    providers: <ProviderSettings />,
    shortcuts: <ShortcutsSettings />,
    templates: <PromptTemplateManager />,
    contentExtraction: <ContentExtractionSettings />,
    embeddings: <EmbeddingSettings />,
    memory: <MemorySettings />,
    voices: <SpeechSettings />,
    reset: <ResetStorage />,
    setup: (
      <div className="space-y-6">
        <PerformanceWarning />
        <Guides />
        <SocialHandles />
      </div>
    )
  }

  const allNavItems = navSections.flatMap((s) => s.items)

  return (
    <div className="mx-auto max-w-8xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("settings.page.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.page.description")}
            </p>
          </div>
          <ThemeToggle showText={false} />
        </div>
      </header>

      <Separator className="mb-6" />

      <div className="flex flex-col lg:flex-row lg:gap-10">
        <SettingsSidebar
          sections={navSections}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        <SettingsMobileNav
          items={allNavItems}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        <main className="min-w-0 flex-1">
          <div key={activeTab}>{tabContent[activeTab]}</div>
        </main>
      </div>
    </div>
  )
}
