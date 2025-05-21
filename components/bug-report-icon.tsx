import { SOCIAL_LINKS } from "@/lib/constant"
import type { LucideIcon } from "lucide-react"

export default function BugReportIcon() {
  const bugLink = SOCIAL_LINKS.find((link) =>
    link.label.toLowerCase().includes("bug")
  )

  if (!bugLink) return null

  const Icon: LucideIcon = bugLink.icon

  return (
    <a
      href={bugLink.href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground transition-colors hover:text-red-500"
      title="Report a bug or request a feature">
      <Icon size="16" />
    </a>
  )
}
