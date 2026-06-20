import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { useTranslation } from "react-i18next"

import { LanguageSelector } from "@/components/language-selector"
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionStack,
  Toolbar,
  TwoColumnGrid
} from "@/components/layout"
import { PerformanceWarning } from "@/components/performance-warning"
import {
  type NavSection,
  PresetPicker,
  SettingsMobileNav,
  SettingsSearch,
  SettingsSidebar
} from "@/components/settings"
import { SocialHandles } from "@/components/social-handles"
import { SocialLinkButton } from "@/components/social-link-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { ChatDisplaySettings, SpeechSettings } from "@/features/chat/components"
import { ContextSettings } from "@/features/context/components/context-settings"
import { ContentExtractionSettings } from "@/features/model/components/content-extraction-settings"
import { EmbeddingSettings } from "@/features/model/components/embedding-settings"
import { ModelSettingsForm } from "@/features/model/components/model-settings-form"
import { ProviderSettings } from "@/features/model/components/provider-settings"
import { PermissionsPanel } from "@/features/permissions/components/permissions-panel"
import { PromptTemplateManager } from "@/features/prompt/components/prompt-template-manager"
import {
  getSettingsEntry,
  isSettingsTab,
  type SettingsTab
} from "@/features/settings/settings-registry"
import type { SettingsSearchRecord } from "@/features/settings/settings-search-index"
import { HIGHLIGHT_FOCUS_DELAY_MS } from "@/lib/constants"
import { SOCIAL_LINKS } from "@/lib/constants-ui"
import {
  BookOpen,
  Brain,
  Database,
  FileText,
  Github,
  RefreshCcw,
  Server,
  Settings,
  Shield,
  Sparkles,
  Volume2,
  Zap
} from "@/lib/lucide-icon"
import { Guides } from "@/options/components/guides"
import { ResetStorage } from "@/options/components/reset-storage"
import { ShortcutsSettings } from "@/options/components/shortcuts-settings"

export const SettingsPage = () => {
  const { t } = useTranslation()
  const desktopSearchRef = useRef<HTMLInputElement>(null)
  const mobileSearchRef = useRef<HTMLInputElement>(null)
  const highlightTimersRef = useRef<Set<number>>(new Set())
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (typeof window === "undefined") return "general"
    const params = new URLSearchParams(window.location.search)
    const requestedTab = params.get("tab")?.replace(/^"+|"+$/g, "")
    // Honor the registry's tab for a deep-linked focus id so links survive a
    // control moving tabs. The focus id's home tab wins over a stale `tab`.
    const focusId = params.get("focus")?.replace(/^"+|"+$/g, "")
    const entryTab = focusId ? getSettingsEntry(focusId)?.tab : undefined
    return entryTab || (requestedTab as SettingsTab) || "general"
  })

  const navSections: NavSection[] = [
    {
      title: t("settings.sections.app"),
      items: [
        { key: "general", label: t("settings.tabs.general"), icon: Settings }
      ]
    },
    {
      title: t("settings.sections.ai_models"),
      items: [
        { key: "models", label: t("settings.tabs.models"), icon: Sparkles },
        {
          key: "providers",
          label: t("settings.tabs.providers"),
          icon: Server,
          badge: "New"
        },
        {
          key: "context",
          label: t("settings.tabs.context"),
          icon: Brain,
          badge: "Beta"
        },
        {
          key: "embeddings",
          label: t("settings.tabs.embeddings"),
          icon: Database,
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
        { key: "prompts", label: t("settings.tabs.prompts"), icon: FileText },
        { key: "shortcuts", label: t("settings.tabs.shortcuts"), icon: Zap },
        { key: "voices", label: t("settings.tabs.voices"), icon: Volume2 }
      ]
    },
    {
      title: t("settings.sections.system"),
      items: [
        {
          key: "permissions",
          label: t("settings.tabs.permissions"),
          icon: Shield
        },
        { key: "reset", label: t("settings.tabs.reset"), icon: RefreshCcw },
        { key: "guides", label: t("settings.tabs.guides"), icon: BookOpen }
      ]
    }
  ]

  const tabContent: Record<string, ReactNode> = {
    general: (
      <SectionStack>
        <PerformanceWarning />
        <TwoColumnGrid>
          <LanguageSelector />
          <ChatDisplaySettings />
        </TwoColumnGrid>
        <PresetPicker />
      </SectionStack>
    ),
    models: (
      <SectionStack>
        <ModelSettingsForm />
      </SectionStack>
    ),
    providers: (
      <SectionStack>
        <ProviderSettings />
      </SectionStack>
    ),
    shortcuts: (
      <SectionStack>
        <ShortcutsSettings />
      </SectionStack>
    ),
    prompts: (
      <SectionStack>
        <PromptTemplateManager />
      </SectionStack>
    ),
    contentExtraction: (
      <SectionStack>
        <ContentExtractionSettings />
      </SectionStack>
    ),
    context: (
      <SectionStack>
        <ContextSettings />
      </SectionStack>
    ),
    embeddings: (
      <SectionStack>
        <EmbeddingSettings />
      </SectionStack>
    ),
    voices: (
      <SectionStack>
        <SpeechSettings />
      </SectionStack>
    ),
    permissions: (
      <SectionStack>
        <PermissionsPanel />
      </SectionStack>
    ),
    reset: (
      <SectionStack>
        <ResetStorage />
      </SectionStack>
    ),
    guides: (
      <SectionStack>
        <Guides />
        <SocialHandles />
      </SectionStack>
    )
  }

  const allNavItems = navSections.flatMap((s) => s.items)
  const validTabKeys = useMemo(
    () => new Set(allNavItems.map((item) => item.key)),
    [allNavItems]
  )

  useEffect(() => {
    if (!validTabKeys.has(activeTab)) {
      setActiveTab("general")
    }
  }, [activeTab, validTabKeys])

  const highlightFocus = useCallback((focusId: string) => {
    if (typeof window === "undefined") return

    let attempts = 0
    const maxAttempts = 40
    const scheduleHighlightTimer = (callback: () => void, delay: number) => {
      const timerId = window.setTimeout(() => {
        highlightTimersRef.current.delete(timerId)
        callback()
      }, delay)
      highlightTimersRef.current.add(timerId)
    }

    const highlightWhenReady = () => {
      attempts += 1

      const focusTarget =
        document.getElementById(focusId) ||
        document.querySelector(`[data-settings-focus-id="${focusId}"]`)

      if (!focusTarget) {
        if (attempts < maxAttempts) {
          scheduleHighlightTimer(highlightWhenReady, 50)
        }
        return
      }

      const focusContainer =
        focusTarget.closest("[data-settings-focus='true']") || focusTarget

      focusContainer.scrollIntoView({ block: "center", behavior: "smooth" })

      focusContainer.classList.add(
        "ring-2",
        "ring-primary",
        "ring-offset-2",
        "ring-offset-background"
      )

      scheduleHighlightTimer(() => {
        focusContainer.classList.remove(
          "ring-2",
          "ring-primary",
          "ring-offset-2",
          "ring-offset-background"
        )
      }, HIGHLIGHT_FOCUS_DELAY_MS)

      if (focusTarget instanceof HTMLElement) {
        focusTarget.focus({ preventScroll: true })
      }
    }

    scheduleHighlightTimer(highlightWhenReady, 0)
  }, [])

  useEffect(
    () => () => {
      for (const timerId of highlightTimersRef.current) {
        window.clearTimeout(timerId)
      }
      highlightTimersRef.current.clear()
    },
    []
  )

  // Sync the tab into the URL and, when a `?focus` id is present, highlight it
  // once the tab's content mounts.
  useEffect(() => {
    if (typeof window === "undefined") return

    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.set("tab", activeTab)
    window.history.replaceState({}, "", nextUrl.toString())

    const focusId = nextUrl.searchParams.get("focus")
    if (focusId) highlightFocus(focusId)
  }, [activeTab, highlightFocus])

  // Search/deep-link navigation to a specific setting. Switching tabs lets the
  // effect above run the highlight; if we're already on the target tab the
  // effect won't re-fire, so highlight directly.
  const navigateToSetting = useCallback(
    (record: SettingsSearchRecord) => {
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href)
        url.searchParams.set("tab", record.tab)
        url.searchParams.set("focus", record.focusId)
        window.history.replaceState({}, "", url.toString())
      }
      if (record.tab !== activeTab) {
        setActiveTab(record.tab)
      } else {
        highlightFocus(record.focusId)
      }
    },
    [activeTab, highlightFocus]
  )

  const handleTabChange = useCallback((key: string) => {
    if (isSettingsTab(key)) setActiveTab(key)
  }, [])

  const githubLink =
    SOCIAL_LINKS.find((link) => link.id === "github")?.href ||
    "https://github.com/Shishir435/ollama-client"

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC")
      const pressedMod = isMac ? event.metaKey : event.ctrlKey
      if (!pressedMod || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== "k") return

      event.preventDefault()
      const refs = [mobileSearchRef, desktopSearchRef]
      const visibleSearch =
        refs.find((ref) => ref.current && ref.current.offsetParent !== null)
          ?.current ??
        desktopSearchRef.current ??
        mobileSearchRef.current
      visibleSearch?.focus()
      visibleSearch?.select()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <AppShell>
      <PageHeader className="z-50">
        <Toolbar className="bg-surface-chat px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("settings.page.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("settings.page.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SocialLinkButton
              href={githubLink}
              icon={Github}
              buttonVariant="ghost"
              size="compact"
              iconSize={16}
              iconOnly
              showShadow={false}
              label={t("social.github")}
              aria-label={t("common.social.visit_profile", {
                platform: t("social.github")
              })}
            />
            <ThemeToggle showText={false} />
          </div>
        </Toolbar>
      </PageHeader>

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden w-64 flex-none flex-col border-r border-sidebar-border bg-surface-sidebar lg:flex">
          <div className="p-4 pb-2">
            <SettingsSearch
              activeTab={activeTab}
              inputRef={desktopSearchRef}
              onSelect={navigateToSetting}
              showShortcutHint
            />
          </div>
          <SettingsSidebar
            sections={navSections}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            className="w-full p-4 pt-2"
          />
        </div>
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-4 pt-4 sm:px-6 lg:hidden">
            <SettingsSearch
              activeTab={activeTab}
              inputRef={mobileSearchRef}
              onSelect={navigateToSetting}
              showShortcutHint
            />
          </div>
          <SettingsMobileNav
            items={allNavItems}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            className="flex-none px-4 pt-4 sm:px-6"
          />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <PageBody>
              <div key={activeTab}>{tabContent[activeTab]}</div>
            </PageBody>
          </main>
        </div>
      </div>
    </AppShell>
  )
}
