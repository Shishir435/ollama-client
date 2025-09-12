import {
  BookOpen,
  Bug,
  Github,
  Globe,
  HelpCircle,
  Instagram,
  Library,
  Linkedin,
  Twitter,
  type LucideIcon
} from "@/lib/lucide-icon"

export interface SocialLink {
  label: string
  href: string
  icon: LucideIcon
}

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
