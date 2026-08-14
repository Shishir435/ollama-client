import {
  BookOpen,
  Bot,
  Brain,
  FileText,
  Github,
  Lock,
  MessageSquare
} from "lucide-react"
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { useTranslation } from "react-i18next"
import { AppShell, PageBody, PageHeader } from "@/components/layout"
import {
  type NavSection,
  SettingsDisclosureControl,
  SettingsDisclosureProvider,
  SettingsMobileNav,
  SettingsSearch,
  SettingsSidebar
} from "@/components/settings"
import { SocialLinkButton } from "@/components/social-link-button"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  getSettingsEntry,
  getSettingsEntryLevel,
  isSettingsLevel,
  isSettingsTab,
  maxSettingsLevel,
  resolveSettingsTab,
  type SettingsLevel,
  type SettingsTab,
  settingsLevelIncludes
} from "@/features/settings/settings-registry"
import type { SettingsSearchRecord } from "@/features/settings/settings-search-index"
import { HIGHLIGHT_FOCUS_DELAY_MS } from "@/lib/constants"
import { SOCIAL_LINKS } from "@/lib/constants-ui"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import GeneralSettingsTab from "@/options/components/tabs/general-settings-tab"

const ModelsSettingsTab = lazy(
  () => import("@/options/components/tabs/models-settings-tab")
)
const BrowserSettingsTab = lazy(
  () => import("@/options/components/tabs/browser-settings-tab")
)
const KnowledgeSettingsTab = lazy(
  () => import("@/options/components/tabs/knowledge-settings-tab")
)
const PrivacySettingsTab = lazy(
  () => import("@/options/components/tabs/privacy-settings-tab")
)
const HelpSettingsTab = lazy(
  () => import("@/options/components/tabs/help-settings-tab")
)

export const SettingsPage = () => {
  const { t } = useTranslation()
  const desktopSearchRef = useRef<HTMLInputElement>(null)
  const mobileSearchRef = useRef<HTMLInputElement>(null)
  const highlightTimersRef = useRef<Set<number>>(new Set())
  const revealedFocusRef = useRef<string | null>(null)
  const userSelectedLevelRef = useRef(false)
  const hydratedLevelRef = useRef(false)
  const promotedLevelRef = useRef<SettingsLevel>("basic")
  const [settingsLevel, setSettingsLevel] = useState<SettingsLevel>("basic")
  const [activeFocusId, setActiveFocusId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return new URLSearchParams(window.location.search).get("focus")
  })
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (typeof window === "undefined") return "general"
    const params = new URLSearchParams(window.location.search)
    const requestedTab = params.get("tab")?.replace(/^"+|"+$/g, "")
    // Honor the registry's tab for a deep-linked focus id so links survive a
    // control moving tabs. The focus id's home tab wins over a stale `tab`.
    const focusId = params.get("focus")?.replace(/^"+|"+$/g, "")
    const entryTab = focusId ? getSettingsEntry(focusId)?.tab : undefined
    return entryTab || resolveSettingsTab(requestedTab) || "general"
  })

  useEffect(() => {
    let active = true
    readSetting(SETTINGS.SETTINGS_LEVEL)
      .then((stored) => {
        if (!active) return
        hydratedLevelRef.current = true
        if (userSelectedLevelRef.current) return

        const storedLevel = isSettingsLevel(stored) ? stored : "basic"
        const reconciledLevel = maxSettingsLevel(
          storedLevel,
          promotedLevelRef.current
        )
        setSettingsLevel(reconciledLevel)
        if (reconciledLevel !== storedLevel) {
          void writeSetting(SETTINGS.SETTINGS_LEVEL, reconciledLevel)
        }
      })
      .catch(() => {
        hydratedLevelRef.current = true
      })
    return () => {
      active = false
    }
  }, [])

  const updateSettingsLevel = useCallback((next: SettingsLevel) => {
    userSelectedLevelRef.current = true
    setSettingsLevel(next)
    void writeSetting(SETTINGS.SETTINGS_LEVEL, next)
  }, [])

  const revealSetting = useCallback(
    (focusId: string) => {
      const required = getSettingsEntryLevel(getSettingsEntry(focusId))
      if (!settingsLevelIncludes(settingsLevel, required)) {
        const promoted = maxSettingsLevel(settingsLevel, required)
        promotedLevelRef.current = maxSettingsLevel(
          promotedLevelRef.current,
          promoted
        )
        setSettingsLevel(promoted)
        if (hydratedLevelRef.current) {
          void writeSetting(SETTINGS.SETTINGS_LEVEL, promoted)
        }
      }
    },
    [settingsLevel]
  )

  useEffect(() => {
    if (!activeFocusId) {
      revealedFocusRef.current = null
      return
    }
    if (revealedFocusRef.current === activeFocusId) return
    revealedFocusRef.current = activeFocusId
    revealSetting(activeFocusId)
  }, [activeFocusId, revealSetting])

  const navSections: NavSection[] = [
    {
      title: t("settings.sections.setup"),
      items: [
        {
          key: "general",
          label: t("settings.tabs.general"),
          icon: MessageSquare
        },
        {
          key: "models",
          label: t("settings.tabs.models"),
          icon: Bot
        },
        {
          key: "knowledge",
          label: t("settings.tabs.context"),
          icon: Brain,
          badge: "Beta"
        },
        {
          key: "browser",
          label: t("settings.tabs.extraction"),
          icon: FileText
        }
      ]
    },
    {
      title: t("settings.sections.privacy"),
      items: [
        {
          key: "privacy",
          label: t("settings.tabs.permissions"),
          icon: Lock
        }
      ]
    },
    {
      title: t("settings.sections.more"),
      items: [{ key: "help", label: t("settings.tabs.guides"), icon: BookOpen }]
    }
  ]

  const tabContent: Record<string, ReactNode> = {
    general: <GeneralSettingsTab activeFocusId={activeFocusId} />,
    models: <ModelsSettingsTab />,
    browser: <BrowserSettingsTab />,
    knowledge: <KnowledgeSettingsTab activeFocusId={activeFocusId} />,
    privacy: <PrivacySettingsTab />,
    help: <HelpSettingsTab />
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
      setActiveFocusId(record.focusId)
      revealSetting(record.focusId)
      if (record.tab !== activeTab) {
        setActiveTab(record.tab)
      } else {
        highlightFocus(record.focusId)
      }
    },
    [activeTab, highlightFocus, revealSetting]
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
    <SettingsDisclosureProvider level={settingsLevel}>
      <AppShell>
        <PageHeader className="z-50">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 bg-surface-chat px-4 py-4 sm:px-6 md:grid-cols-[auto_minmax(15rem,18rem)_minmax(0,1fr)_auto] md:gap-x-5 lg:px-8">
            <h1 className="col-start-1 row-start-1 min-w-0 text-2xl font-semibold tracking-tight">
              {t("settings.page.title")}
            </h1>
            <p className="col-span-2 row-start-2 min-w-0 text-sm text-muted-foreground md:col-span-3 md:col-start-1">
              {t("settings.page.description")}
            </p>
            <SettingsDisclosureControl
              level={settingsLevel}
              onLevelChange={updateSettingsLevel}
              className="col-span-2 row-start-3 mt-2 md:col-span-1 md:col-start-2 md:row-start-1 md:mt-0"
            />
            <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 md:col-start-4">
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
          </div>
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
              className="w-full min-h-0 flex-1 p-4 pt-2"
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
                <Suspense
                  fallback={
                    <div className="h-24 animate-pulse rounded-panel bg-muted/40" />
                  }>
                  <div key={activeTab}>{tabContent[activeTab]}</div>
                </Suspense>
              </PageBody>
            </main>
          </div>
        </div>
      </AppShell>
    </SettingsDisclosureProvider>
  )
}
