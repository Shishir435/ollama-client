import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"

import { LanguageSelector } from "@/components/language-selector"
import { PerformanceWarning } from "@/components/performance-warning"
import { SocialHandles } from "@/components/social-handles"
import { ThemeToggle } from "@/components/theme-toggle"
import { MiniBadge } from "@/components/ui/mini-badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { ChatDisplaySettings } from "@/features/chat/components/chat-display-settings"
import { SpeechSettings } from "@/features/chat/components/speech-settings"
import { MemorySettings } from "@/features/memory/components/memory-settings"
import { ContentExtractionSettings } from "@/features/model/components/content-extraction-settings"
import { EmbeddingSettings } from "@/features/model/components/embedding-settings"
import { ModelSettingsForm } from "@/features/model/components/model-settings-form"
import { ProviderSettings } from "@/features/model/components/provider-settings"
import { PromptTemplateManager } from "@/features/prompt/components/prompt-template-manager"
import type { LucideIcon } from "@/lib/lucide-icon"
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
import { cn } from "@/lib/utils"
import { Guides } from "@/options/components/guides"
import { ResetStorage } from "@/options/components/reset-storage"
import { ShortcutsSettings } from "@/options/components/shortcuts-settings"

interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  badge?: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
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

      <div className="flex flex-col lg:flex-row lg:gap-8">
        {/* Sidebar — Desktop */}
        <aside className="hidden lg:block w-56 shrink-0 border-r border-border">
          <nav className="sticky top-8" aria-label="Settings navigation">
            <ScrollArea className="h-[calc(100vh-12rem)]">
              <div className="space-y-6 pr-4">
                {navSections.map((section, idx) => (
                  <div key={section.title}>
                    {idx > 0 && <Separator className="mb-4" />}
                    <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {section.title}
                    </p>
                    <div className="space-y-0.5">
                      {section.items.map((item) => {
                        const Icon = item.icon
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => setActiveTab(item.key)}
                            aria-current={
                              activeTab === item.key ? "page" : undefined
                            }
                            className={cn(
                              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                              activeTab === item.key
                                ? "bg-accent text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                            )}>
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                            {item.badge && (
                              <MiniBadge
                                text={item.badge}
                                className="ml-auto"
                              />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </nav>
        </aside>

        {/* Mobile Nav */}
        <nav className="mb-6 lg:hidden" aria-label="Settings navigation">
          <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1 scrollbar-none">
            {allNavItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  aria-current={activeTab === item.key ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    activeTab === item.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {item.label}
                  {item.badge && <MiniBadge text={item.badge} />}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Content */}
        <main className="min-w-0 flex-1">
          <div key={activeTab}>{tabContent[activeTab]}</div>
        </main>
      </div>
    </div>
  )
}
