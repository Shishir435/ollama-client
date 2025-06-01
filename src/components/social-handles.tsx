import { SOCIAL_LINKS } from "@/lib/constant"

function SocialHandles() {
  return (
    <div className="mb-6 flex flex-wrap justify-center gap-4 text-muted-foreground">
      {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-foreground">
          <Icon size={16} />
          {label}
        </a>
      ))}
    </div>
  )
}

export default SocialHandles
