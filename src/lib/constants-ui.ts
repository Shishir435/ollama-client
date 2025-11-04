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

export interface SocialLink {
  label: string
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

// Scroll strategy descriptions
export const SCROLL_STRATEGY_DESCRIPTIONS: Record<ScrollStrategy, string> = {
  none: "Fastest extraction, no lazy loading support",
  instant: "Quick scroll, good for simple lazy loading",
  gradual: "Smooth scrolling with delays, balanced speed/accuracy",
  smart:
    "Intelligent scrolling with content detection, best for dynamic content"
}

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
    label: "Ollama Client Setup Guide",
    href: "https://ollama-client.shishirchaurasiya.in/ollama-setup-guide",
    icon: BookOpen,
    description: "Complete installation and configuration guide",
    badge: "Guide"
  },
  {
    label: "Official Ollama Model Library",
    href: "https://ollama.com/library",
    icon: Library,
    description: "Browse available AI models and documentation",
    badge: "Library"
  },
  {
    label: "GitHub Repo",
    href: "https://github.com/Shishir435/ollama-client",
    icon: Github,
    description: "Source code, releases, and contribution guidelines",
    badge: "Code"
  },
  {
    label: "Troubleshooting & FAQ",
    href: "https://github.com/Shishir435/ollama-client/issues",
    icon: HelpCircle,
    description: "Common issues and community support",
    badge: "Help"
  }
]

export const SOCIAL_LINKS: SocialLink[] = [
  {
    label: "GitHub Page",
    href: "https://github.com/Shishir435/ollama-client",
    icon: Github
  },
  {
    label: "Portfolio",
    href: "https://www.shishirchaurasiya.in/",
    icon: Globe
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/shishir-chaurasiya/",
    icon: Linkedin
  },
  {
    label: "Twitter",
    href: "https://twitter.com/_shishir435",
    icon: Twitter
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/_shishir435/",
    icon: Instagram
  },
  {
    label: "Report Bug / Feature",
    href: "https://github.com/Shishir435/ollama-client/issues",
    icon: Bug
  }
]
