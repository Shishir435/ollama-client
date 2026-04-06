export type NavItem = {
  label: string
  href: string
}

export type NavSection = {
  title: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Home", href: "/" },
      { label: "Architecture", href: "/architecture" }
    ]
  },
  {
    title: "Guides",
    items: [{ label: "Setup Guide", href: "/ollama-setup-guide" }]
  },
  {
    title: "Legal",
    items: [{ label: "Privacy Policy", href: "/privacy-policy" }]
  }
]
