import {
  BookOpen,
  Bug,
  Github,
  Globe,
  HelpCircle,
  Instagram,
  Library,
  Linkedin,
  type LucideIcon,
  Twitter
} from "@/lib/lucide-icon"
import type { ContentScraper, ScrollStrategy } from "@/types"

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" }
  // { value: "es", label: "Spanish" },
  // { value: "fr", label: "French" },
  // { value: "de", label: "German" },
  // { value: "it", label: "Italian" },
  // { value: "pt", label: "Portuguese" },
  // { value: "zh", label: "Chinese (Simplified)" },
  // { value: "ja", label: "Japanese" },
  // { value: "ko", label: "Korean" },
  // { value: "ru", label: "Russian" },
  // { value: "ar", label: "Arabic" },
  // { value: "tr", label: "Turkish" },
  // { value: "nl", label: "Dutch" },
  // { value: "pl", label: "Polish" },
  // { value: "sv", label: "Swedish" },
  // { value: "vi", label: "Vietnamese" },
  // { value: "th", label: "Thai" },
  // { value: "id", label: "Indonesian" },
  // { value: "cs", label: "Czech" },
  // { value: "ro", label: "Romanian" },
  // { value: "hu", label: "Hungarian" },
  // { value: "el", label: "Greek" },
  // { value: "da", label: "Danish" },
  // { value: "fi", label: "Finnish" },
  // { value: "no", label: "Norwegian" },
  // { value: "he", label: "Hebrew" },
  // { value: "uk", label: "Ukrainian" },
  // { value: "ms", label: "Malay" },
  // { value: "fa", label: "Persian" },
  // { value: "bg", label: "Bulgarian" },
  // { value: "sk", label: "Slovak" },
  // { value: "sr", label: "Serbian" },
  // { value: "hr", label: "Croatian" },
  // { value: "lt", label: "Lithuanian" },
  // { value: "lv", label: "Latvian" },
  // { value: "et", label: "Estonian" },
  // { value: "sl", label: "Slovenian" },
  // { value: "bn", label: "Bengali" },
  // { value: "ur", label: "Urdu" },
  // { value: "sw", label: "Swahili" },
  // { value: "ca", label: "Catalan" },
  // { value: "eu", label: "Basque" },
  // { value: "gl", label: "Galician" },
  // { value: "is", label: "Icelandic" },
  // { value: "ka", label: "Georgian" },
  // { value: "hy", label: "Armenian" },
  // { value: "az", label: "Azerbaijani" },
  // { value: "kk", label: "Kazakh" },
  // { value: "ta", label: "Tamil" },
  // { value: "te", label: "Telugu" },
  // { value: "mr", label: "Marathi" }
] as const

export interface SocialLink {
  id: string
  labelKey: string
  href: string
  icon: LucideIcon
}

// Configuration for timeout input fields (UI only - without icons)
export const TIMEOUT_FIELDS_CONFIG = [
  {
    id: "scroll-delay",
    name: "scrollDelay" as const,
    label: "Scroll Delay (ms)",
    min: 0,
    max: 2000,
    step: 50
  },
  {
    id: "mutation-timeout",
    name: "mutationObserverTimeout" as const,
    label: "Mutation Observer Timeout (ms)",
    min: 0,
    max: 10000,
    step: 500
  },
  {
    id: "network-timeout",
    name: "networkIdleTimeout" as const,
    label: "Network Idle Timeout (ms)",
    min: 0,
    max: 5000,
    step: 100
  },
  {
    id: "max-wait",
    name: "maxWaitTime" as const,
    label: "Max Wait Time (ms)",
    min: 1000,
    max: 60000,
    step: 1000
  }
] as const

// Scroll strategy options with short labels (for site-specific overrides)
export const SCROLL_STRATEGY_OPTIONS_SHORT = [
  { value: "none" as ScrollStrategy, label: "None" },
  { value: "instant" as ScrollStrategy, label: "Instant" },
  { value: "gradual" as ScrollStrategy, label: "Gradual" },
  { value: "smart" as ScrollStrategy, label: "Smart" }
] as const

// Scroll strategy options with descriptive labels (for global settings)
export const SCROLL_STRATEGY_OPTIONS = [
  { value: "none" as ScrollStrategy, label: "None - No scrolling" },
  { value: "instant" as ScrollStrategy, label: "Instant - Quick scroll" },
  { value: "gradual" as ScrollStrategy, label: "Gradual - Smooth scrolling" },
  { value: "smart" as ScrollStrategy, label: "Smart - Intelligent detection" }
] as const

// Content scraper options
export const CONTENT_SCRAPER_OPTIONS = [
  {
    value: "auto" as ContentScraper,
    label: "Auto",
    description: "Smart fallback: Defuddle → Readability",
    detail:
      "Best for most websites. Tries Defuddle first for better markdown and code formatting, falls back to Readability if needed.",
    recommended: true
  },
  {
    value: "defuddle" as ContentScraper,
    label: "Defuddle",
    description: "Technical & code-heavy content",
    detail:
      "Best for GitHub, documentation, Stack Overflow, and developer blogs. Preserves code blocks and markdown structure.",
    recommended: false
  },
  {
    value: "readability" as ContentScraper,
    label: "Readability",
    description: "Articles & blog posts",
    detail:
      "Best for news articles, Medium posts, and traditional blog content. Mozilla's proven algorithm for clean text extraction.",
    recommended: false
  }
]

export const GUIDES = [
  {
    labelKey: "guides.items.setup.label",
    href: "https://ollama-client.shishirchaurasiya.in/ollama-setup-guide",
    icon: BookOpen,
    descriptionKey: "guides.items.setup.description",
    badgeKey: "guides.items.setup.badge"
  },
  {
    labelKey: "guides.items.library.label",
    href: "https://ollama.com/library",
    icon: Library,
    descriptionKey: "guides.items.library.description",
    badgeKey: "guides.items.library.badge"
  },
  {
    labelKey: "guides.items.github.label",
    href: "https://github.com/Shishir435/ollama-client",
    icon: Github,
    descriptionKey: "guides.items.github.description",
    badgeKey: "guides.items.github.badge"
  },
  {
    labelKey: "guides.items.faq.label",
    href: "https://github.com/Shishir435/ollama-client/issues",
    icon: HelpCircle,
    descriptionKey: "guides.items.faq.description",
    badgeKey: "guides.items.faq.badge"
  }
]

export const SOCIAL_LINKS = [
  {
    id: "github",
    labelKey: "social.github",
    href: "https://github.com/Shishir435/ollama-client",
    icon: Github
  },
  {
    id: "portfolio",
    labelKey: "social.portfolio",
    href: "https://www.shishirchaurasiya.in/",
    icon: Globe
  },
  {
    id: "linkedin",
    labelKey: "social.linkedin",
    href: "https://www.linkedin.com/in/shishir-chaurasiya/",
    icon: Linkedin
  },
  {
    id: "twitter",
    labelKey: "social.twitter",
    href: "https://twitter.com/_shishir435",
    icon: Twitter
  },
  {
    id: "instagram",
    labelKey: "social.instagram",
    href: "https://www.instagram.com/_shishir435/",
    icon: Instagram
  },
  {
    id: "bug_report",
    labelKey: "social.bug_report",
    href: "https://github.com/Shishir435/ollama-client/issues",
    icon: Bug
  }
]
